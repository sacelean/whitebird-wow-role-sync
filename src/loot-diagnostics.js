const networkCodes = new Set(['ECONNRESET','ETIMEDOUT','ENOTFOUND','ECONNREFUSED','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','SQLITE_BUSY','SQLITE_READONLY','SQLITE_FULL','SQLITE_IOERR','SQLITE_CONSTRAINT','SQLITE_CORRUPT']);
const validationKeys = new Set(['embeds','description','fields','name','value','title','footer','text','color','timestamp','content','attachments','files','allowed_mentions','parse','users','roles','nonce']);
const safeCode = code => Number.isInteger(code) ? code : networkCodes.has(code) ? code : null;
function validationPaths(errors, path = [], result = []) {
  if (!errors || typeof errors !== 'object' || result.length >= 20) return result;
  if (Array.isArray(errors._errors)) {
    for (const e of errors._errors) {
      if (result.length < 20 && typeof e.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code)) result.push({path:path.join('.'),code:e.code});
    }
  }
  for (const [key,value] of Object.entries(errors)) {
    if (validationKeys.has(key) || /^\d{1,3}$/.test(key)) validationPaths(value,[...path,key],result);
  }
  return result;
}

// Never log request bodies, response messages, URLs, credentials or arbitrary exception text.
export function logLootFailure(operation, error, context = {}, logger = console.error) {
  const name = typeof error?.name === 'string' && /^(DiscordAPIError(?:\[\d+\])?|HTTPError|AbortError|TimeoutError|TypeError|RangeError|Error|LootPanelError|SqliteError)$/.test(error.name) ? error.name : 'Error';
  const status = Number.isInteger(error?.status) ? error.status : null;
  const diagnostic = {
    operation,
    guildId: context.guildId ?? null,
    channelId: context.channelId ?? null,
    messageId: context.messageId ?? null,
    panelStatus: context.panelStatus ?? null,
    error: name, status, code: safeCode(error?.code), causeCode: safeCode(error?.cause?.code),
    invalidFields: validationPaths(error?.rawError?.errors)
  };
  logger('[WoWAudit/Discord] ' + JSON.stringify(diagnostic));
  return diagnostic;
}
