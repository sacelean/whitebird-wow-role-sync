#!/usr/bin/env bash
set -euo pipefail

for name in OCI_HOST OCI_USER OCI_SSH_KEY OCI_KNOWN_HOSTS OCI_DEPLOY_PATH OCI_SSH_PORT; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing secret: $name" >&2
    exit 1
  fi
done
[[ "$OCI_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$OCI_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]
[[ "$OCI_SSH_PORT" =~ ^[0-9]+$ ]]
# Restrict the path so it can be safely passed through SSH and rsync shells.
[[ "$OCI_DEPLOY_PATH" =~ ^/([a-zA-Z0-9_-]+/)+[a-zA-Z0-9_-]+$ ]]

ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$OCI_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$OCI_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
export RSYNC_RSH="ssh -i $ssh_dir/key -p $OCI_SSH_PORT -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ssh_dir/known_hosts -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4"
target="$OCI_USER@$OCI_HOST"
ssh_options=(-i "$ssh_dir/key" -p "$OCI_SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

# Require an existing, dedicated deployment directory and persistent data.
ssh "${ssh_options[@]}" "$target" "test -f '$OCI_DEPLOY_PATH/.env' && test -d '$OCI_DEPLOY_PATH/data' && test -f '$OCI_DEPLOY_PATH/.allow-github-deploy' && command -v rsync >/dev/null && docker compose version >/dev/null"

# Exclusions also protect server-only files from deletion.
rsync -az --delete --exclude='.git/' --exclude='.env' --exclude='data/' \
  --exclude='node_modules/' --exclude='.allow-github-deploy' --exclude='.deploy.lock' \
  ./ "$target:$OCI_DEPLOY_PATH/"

ssh "${ssh_options[@]}" "$target" "bash -s -- '$OCI_DEPLOY_PATH'" <<'REMOTE'
set -euo pipefail
cd "$1"
# Serialize with manual deployments that use the same lock.
exec 9>.deploy.lock
flock -n 9
docker compose config --quiet
docker compose build bot
docker compose run --rm --no-deps bot npm run register
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker compose up -d --no-deps --force-recreate bot
container=$(docker compose ps -q bot)
for attempt in {1..30}; do
  state=$(docker inspect --format '{{.State.Status}} {{.RestartCount}}' "$container")
  if [[ "$state" == 'running 0' ]] && docker logs --since "$started_at" "$container" 2>&1 | grep -q 'Whitebird WoW Role Sync conectado como'; then
    echo 'Deploy completed: bot connected to Discord.'
    exit 0
  fi
  sleep 2
done
echo 'Bot did not connect to Discord within 60 seconds. Check docker compose logs bot on OCI.' >&2
exit 1
REMOTE
