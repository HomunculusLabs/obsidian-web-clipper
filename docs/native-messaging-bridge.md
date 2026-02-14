# Native Messaging Bridge (Task E2)

The extension cannot execute local binaries directly from a Manifest V3 service worker.
To support Obsidian CLI saves, the background worker now sends a message to a Native Messaging host.

## Host name

`com.t3rpz.obsidian_web_clipper`

This must match the host manifest installed on the local machine.

## Extension side flow

1. Popup sends `saveToCli` runtime request.
2. `src/background/handlers/saveToCli.ts` validates input.
3. Handler calls `chrome.runtime.sendNativeMessage()` via `src/background/nativeMessaging.ts`.
4. Native host executes Obsidian CLI and returns a structured result.

## Message contract

### Request

```json
{
  "action": "saveToCli",
  "payload": {
    "cliPath": "/path/to/obsidian-cli",
    "vault": "Main Vault",
    "filePath": "Folder/Note",
    "content": "# Markdown note"
  }
}
```

### Response (success)

```json
{
  "success": true,
  "data": {
    "saved": true
  }
}
```

### Response (error)

```json
{
  "success": false,
  "error": "Human-readable error",
  "code": "OPTIONAL_ERROR_CODE"
}
```

## Notes

- `manifest.json` now includes `nativeMessaging` permission.
- If the host is missing or not allowed, save returns `requiresBridge: true` so fallback logic can continue.

## Attachment write contract (`saveAttachmentToCli`)

### Request

```json
{
  "action": "saveAttachmentToCli",
  "payload": {
    "cliPath": "/path/to/obsidian-cli",
    "vault": "Main Vault",
    "filePath": "attachments/image-1.png",
    "base64Data": "iVBORw0KGgoAAAANSUhEUg...",
    "mimeType": "image/png"
  }
}
```

### Response (success)

```json
{
  "success": true,
  "data": {
    "filePath": "attachments/image-1.png"
  }
}
```

`data.savedPath` is also accepted for backward compatibility with older host responses.
