const LOCAL_WORDING_PATTERN =
  /(?:本地|本机|当前电脑|我的电脑|这台电脑|当前机器|local(?:\s+machine)?|this\s+machine|my\s+(?:mac|computer|machine))/i

const HOSTS_FILE_PATTERN = /(?:\/etc\/hosts\b|hosts\s*文件|hosts\s*file)/i
const LOCAL_PATH_PATTERN =
  /(?:~\/|~(?:\s|$)|\$HOME(?:\/|\s|$)|\/Users\/[^\s`"'<>]+|\/home\/[^\s`"'<>]+|\/etc\/hosts\b)/i
const LOCAL_INSPECT_PATTERN =
  /(?:查看|看看|看一下|列出|显示|git|\blog\b|diff|status|提交记录|提交历史|仓库)/i
const FILE_OPERATION_PATTERN =
  /(?:修改|改为|替换|调整|更新|编辑|删除|移除|写入|保存|change|replace|update|edit|modify|remove|delete|write|save)/i
const LOCAL_PROMPT_FILE_READ_PATTERN =
  /(?:^|\n)\s*(?:➜\s+~|[$#]\s*|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+[:\s][~/][^\n]*[$#])\s*(?:sudo\s+)?(?:cat|sed|grep|less|more|head|tail)\s+(?:\/etc\/hosts\b|~\/|\$HOME\b|\/Users\/)/im
const HOSTS_FILE_CONTENT_PATTERN =
  /(?:#\s*Host Database|127\.0\.0\.1\s+localhost|255\.255\.255\.255\s+broadcasthost|::1\s+localhost)/i

const REMOTE_CONNECTION_PATTERN =
  /(?:^|\s)(?:ssh|login|connect)\b|(?:连接|登录|登陆|登入|进入|切换).{0,12}(?:远程|服务器|主机|集群|环境|ssh)/i

export function hasExplicitLocalFileOperationIntent(input: string): boolean {
  const value = input.trim()
  if (!value) return false

  const hasLocalMarker =
    LOCAL_WORDING_PATTERN.test(value) ||
    LOCAL_PROMPT_FILE_READ_PATTERN.test(value) ||
    LOCAL_PATH_PATTERN.test(value) ||
    HOSTS_FILE_CONTENT_PATTERN.test(value)
  if (!hasLocalMarker) return false

  const hasFileTarget =
    HOSTS_FILE_PATTERN.test(value) ||
    LOCAL_PATH_PATTERN.test(value) ||
    HOSTS_FILE_CONTENT_PATTERN.test(value)
  const hasFileOperation = FILE_OPERATION_PATTERN.test(value)
  if (!hasFileTarget || !hasFileOperation) return false

  if (REMOTE_CONNECTION_PATTERN.test(value) && !LOCAL_WORDING_PATTERN.test(value)) return false

  return true
}

/** Local inspect/edit that must not trigger SSH matching or login. */
export function hasExplicitLocalWorkIntent(input: string): boolean {
  if (hasExplicitLocalFileOperationIntent(input)) return true
  const value = input.trim()
  if (!value) return false
  if (!LOCAL_WORDING_PATTERN.test(value)) return false
  return LOCAL_PATH_PATTERN.test(value) || LOCAL_INSPECT_PATTERN.test(value)
}

export function explainLocalFileOperationBypass(): string {
  return [
    'Request is classified as local work.',
    'Local wording, a local path (~, $HOME, /Users), a local shell prompt, or pasted file contents take precedence over configured SSH connection name or host matches.',
    'Path fragments such as aide-family are not connection names. IP addresses inside file contents are treated as data to edit, not remote connection targets.'
  ].join(' ')
}
