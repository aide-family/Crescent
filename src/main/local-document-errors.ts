export type LocalDocumentErrorKind =
  | 'not-found'
  | 'not-authorized'
  | 'system-permission'
  | 'symlink'
  | 'encoding'
  | 'too-large'
  | 'invalid-document'
  | 'cancelled'

export class LocalDocumentError extends Error {
  constructor(
    readonly kind: LocalDocumentErrorKind,
    message: string,
    readonly code?: string
  ) {
    super(message)
    this.name = 'LocalDocumentError'
  }
}

/** Error messages cross Electron's invoke boundary, so include recovery in the message. */
export function localDocumentError(error: unknown): LocalDocumentError {
  if (error instanceof LocalDocumentError) return error
  const value = error as NodeJS.ErrnoException
  const message = value?.message ?? String(error)
  let kind: LocalDocumentErrorKind = 'invalid-document'
  let recovery = '确认该文件是普通 UTF-8/UTF-16 文本，目录可使用目录列表。'
  if (value?.code === 'ENOENT') {
    kind = 'not-found'
    recovery = '路径不存在，请核对本机绝对路径；SSH 路径不能用于本地读取。'
  } else if (value?.code === 'EACCES' || value?.code === 'EPERM') {
    kind = 'system-permission'
    recovery = '系统拒绝访问，请在 macOS 隐私与安全性中授予 Crescent 对该目录的访问权限。'
  } else if (value?.name === 'AbortError') {
    kind = 'cancelled'
    recovery = '读取已取消，可缩小范围后重试。'
  } else if (/outside|Sensitive/.test(message)) {
    kind = 'not-authorized'
    recovery = '通过本地文档入口选择并授权目录；敏感路径必须手工处理。'
  } else if (/Symlink|symlink|ELOOP/.test(message)) {
    kind = 'symlink'
    recovery = '请选择真实目录或文件，不要使用符号链接。'
  } else if (/encoding|encoded|UTF/i.test(message)) {
    kind = 'encoding'
    recovery = '请将文本另存为 UTF-8 或 UTF-16 后重试。'
  } else if (/limit|at most|exceeds/i.test(message)) {
    kind = 'too-large'
    recovery = '请分割文件或缩小读取范围；单行也不能超过预览限制。'
  }
  return new LocalDocumentError(kind, `[${kind}] ${message}\n${recovery}`, value?.code)
}
