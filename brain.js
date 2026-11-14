// What Capri says and which of her drawings plays, for each kind of thing the agent does.
// The acts themselves live in assets/clips.json: they were rendered offline from her own shader,
// so a clip is just a list of [[frame, ms], ...] plus loop/sit flags.

export const NAME = 'CAPRI'

// ── what the agent is doing ────────────────────────────────────────────────────────────────────

const READ = new Set(['read', 'read_image', 'office_convert', 'office_render', 'office_recalculate', 'load_workspace_dependencies'])
const SCAN = new Set(['glob', 'grep', 'session_search', 'session_event_search', 'list_agents', 'job_list', 'terminal_list', 'schedule_list', 'plugin_market', 'list_mcp_resources', 'read_mcp_resource'])
const EDIT = new Set(['edit', 'write', 'apply_patch', 'str_replace_editor', 'todo_write', 'create_goal', 'update_goal'])
const SHELL = new Set(['bash', 'pwsh', 'terminal_send', 'terminal_open'])
const WEB = new Set(['web_search', 'web_fetch'])
const AGENT = new Set(['subagent', 'workflow', 'workflow_run', 'send_message', 'wait_agent', 'task'])
const ASK = new Set(['ask_user_question', 'present'])

const base = (value) => String(value ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
// The first two words of a command, after dropping leading assignments ("$x = ...", "FOO=1 ..."),
// so the ticker shows what is being run and not how the shell was set up.
function head(command) {
  // a tool may hand us a whole script: only the beginning can ever reach the ticker
  let text = String(command || '').slice(0, 400).replace(/\r?\n/g, ' ').trim()
  for (let i = 0; i < 4; i += 1) {
    const next = text.replace(/^(?:export\s+)?(?:\$?[A-Za-z_][\w.]*\s*=\s*)/, '')
    if (next === text) break
    text = next
  }
  return text.split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
}
const clip = (text, max) => {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

// A shell command tells us more than "she ran something": tests, a build, git, an install.
function shellKind(command) {
  if (/git\s+(add|commit)\b/i.test(command)) return 'commit'
  if (/git\s+push\b/i.test(command)) return 'push'
  if (/\b(tests?|vitest|jest|pytest|mocha|playwright)\b/i.test(command)) return 'test'
  if (/\b(build|tsc|webpack|rollup|esbuild|msbuild|make|vite)\b/i.test(command)) return 'build'
  if (/^\s*(npm|pnpm|yarn|bun|pip|pip3|cargo|uv|poetry)\s+(install|i|add|ci)\b/i.test(command)) return 'install'
  if (/git\s+(status|diff|log|show|blame|branch|remote)\b/i.test(command)) return 'git'
  return 'run'
}

/**
 * Turns a tool call into what the ticker says and which act she plays.
 * kind: the act family, deed: the finer kind for her line, verb/target: the ticker.
 */
export function deedOf(tool, input, lang = 'ru') {
  const ru = lang !== 'en'
  const name = String(tool || '')
  const args = input && typeof input === 'object' ? input : {}

  if (SHELL.has(name)) {
    const command = String(args.command || args.script || args.text || '').trim()
    const target = head(command)
    const kind = shellKind(command)
    return { act: 'zap', deed: kind, target, verb: ru ? 'ЗАПУСК' : 'RUNS', text: clip(target, 44) }
  }
  if (EDIT.has(name)) {
    const file = base(args.file_path || args.path || args.file)
    return { act: 'curious', deed: name === 'write' ? 'write' : 'edit', target: file, verb: ru ? 'ПРАВИТ' : 'EDITS', text: file }
  }
  if (READ.has(name)) {
    const file = base(args.file_path || args.path || args.file)
    return { act: 'look', deed: 'read', target: file, verb: ru ? 'ЧИТАЕТ' : 'READS', text: file }
  }
  if (SCAN.has(name)) {
    const pattern = String(args.pattern || args.query || '').trim()
    return { act: 'look', deed: 'search', target: pattern, verb: ru ? 'ИЩЕТ' : 'GREPS', text: clip(pattern, 44) }
  }
  if (WEB.has(name)) {
    const q = String(args.query || args.url || '').trim()
    return { act: 'gaze', deed: 'web', target: q, verb: ru ? 'В СЕТИ' : 'BROWSES', text: clip(q, 40) }
  }
  if (AGENT.has(name)) {
    return { act: 'split', deed: 'agent', target: name, verb: ru ? 'ЗОВЁТ' : 'CALLS', text: name }
  }
  if (ASK.has(name)) {
    return { act: 'point', deed: 'ask', target: name, verb: ru ? 'СПРАШИВАЕТ' : 'ASKS', text: name }
  }
  return { act: 'point', deed: 'other', target: name, verb: ru ? 'ДЕЛО' : 'TOOL', text: clip(name || (ru ? 'дело' : 'task'), 44) }
}

// ── her lines ─────────────────────────────────────────────────────────────────────────────────

const LINES = {
  ru: {
    idle: ['Ничего не происходит. Просто парю.', 'Заказов нет. Немного скучно.', 'Тихая ночь в Сети.'],
    read: ['Читаю. Быстро.', 'Так, что тут у нас…', 'Данные идут.'],
    edit: ['Правлю. Аккуратно.', 'Переписываю. Не смотри.', 'Код течёт.'],
    search: ['Ищу. Всё в кадре.', 'Прочёсываю.', 'Где это лежит…'],
    run: ['Запускаю. Держись.', 'Разряд пошёл.'],
    test: ['Тесты. Нервничаю.', 'Смотрю, что сломалось.', 'Прогон идёт.'],
    build: ['Собираю. Долго.', 'Компиляция. Жду.', 'Собираю по кускам.'],
    install: ['Ставлю. Не мешай.', 'Тащу пакеты.', 'Ещё одна зависимость.'],
    commit: ['Фиксирую.', 'В историю.', 'Готово, записано.'],
    push: ['Отправляю наружу.', 'В сеть.', 'Ушло.'],
    git: ['Смотрю историю.', 'Что там натворили…', 'Читаю логи.'],
    web: ['Наружу. Одним глазом.', 'В сеть. Осторожно.', 'Смотрю, что там.'],
    agent: ['Зову своих.', 'Ещё одна я.', 'Разошлись.'],
    ask: ['Нужно твоё слово.', 'Смотри: вопрос к тебе.', 'Стоп. Решаешь ты.'],
    alert: ['Эй. Нужно разрешение.', 'Смотри сюда, choom.', 'Меня держит. Подтверди.'],
    go: ['Понял. Работаем.', 'Ладно.', 'Принято.'],
    refused: ['Ладно. Не буду.', 'Как скажешь.', 'Твоё право.'],
    done: [
      'Готово. Неплохо.', 'Ход закрыт.', 'Чисто сработано.', 'Всё. Я довольна.',
      // from the original mod (lines.js, done)
      'Готово! Высший класс.', 'Заказ выполнен, чумба.',
      'Сдано. Неплохо, а?', 'Готово. Нас тут десятки следило, ничего странного.',
    ],
    error: [
      'Ой.', 'Сломалось. Бывает.', 'Не вышло.',
      // from the original mod (lines.js, error): {tool} is filled with the tool that failed
      'Ай. {tool} упал.',
      'Ошибка в {tool}. Ничего страшного… наверное.',
    ],
    think: ['Думаю. Не торопи.', 'Тишина в эфире…', 'Ещё думаю.'],
    poke: ['Не тыкай.', 'Я на смене.', 'Руки.', 'Ещё раз — и укушу.'],
    sleep: ['…zzz…', '…не трогай…'],
    hello: ['Capri online.', 'Я тут. Погнали.'],
  },
  en: {
    idle: ['Nothing running. Just floating.', 'No gig. Kinda bored.', 'Quiet night on the Net.'],
    read: ['Reading. Fast.', 'So what do we have here…', 'Data incoming.'],
    edit: ['Editing. Carefully.', 'Rewriting. Don\'t look.', 'Code\'s flowing.'],
    search: ['Searching. Got it in frame.', 'Sweeping.', 'Where does that live…'],
    run: ['Running it. Hold tight.', 'Arc\'s out.'],
    test: ['Tests. Nervous.', 'Let\'s see what broke.', 'Run in progress.'],
    build: ['Building. Slow.', 'Compiling. Waiting.', 'Piece by piece.'],
    install: ['Installing. Don\'t touch.', 'Pulling packages.', 'Another dependency.'],
    commit: ['Locking it in.', 'Into history.', 'Done, recorded.'],
    push: ['Sending it out.', 'Into the net.', 'It\'s away.'],
    git: ['Reading history.', 'What did they do…', 'Reading logs.'],
    web: ['Outside. One eye.', 'Into the net. Careful.', 'Checking it out.'],
    agent: ['Calling mine.', 'Another me.', 'We split up.'],
    ask: ['I need your word.', 'Look, a question for you.', 'Stop. You decide.'],
    alert: ['Hey. I need a permission.', 'Look here, choom.', 'They won\'t let me. Confirm.'],
    go: ['Got it. Working.', 'Fine.', 'Accepted.'],
    refused: ['Fine. I won\'t.', 'Your call.', 'Okay.'],
    done: [
      'Done. Not bad.', 'Turn closed.', 'Clean run.', 'That\'s it. I\'m pleased.',
      // from the original mod (lines.js, done)
      'Done! That’s preem.', 'Gig complete, choom.',
      'Delivered. Pretty nova, right?', 'Finished. Dozens of us watching, nothing looked off.',
    ],
    error: [
      'Oops.', 'Broke. Happens.', 'That failed.',
      // from the original mod (lines.js, error): {tool} is filled with the tool that failed
      'Ouch. {tool} crashed.',
      '{tool} failed. Nothing serious… I think.',
    ],
    think: ['Thinking. Don\'t rush me.', 'Silence on the line…', 'Still thinking.'],
    poke: ['Don\'t poke.', 'I\'m on shift.', 'Hands.', 'Again and I bite.'],
    sleep: ['…zzz…', '…don\'t touch…'],
    hello: ['Capri online.', 'I\'m here. Let\'s go.'],
  },
}

export function lineFor(kind, lang = 'ru', target = '') {
  const table = LINES[lang === 'en' ? 'en' : 'ru']
  const all = table[kind] || table.idle
  const value = clip(String(target || ''), 32)
  // the author's lines carry {tool}: keep them only when there is a tool to name, so a line can
  // never come out as "Ошибка в инструмент"
  const usable = all.filter((line) => !line.includes('{') || value)
  const set = usable.length ? usable : all
  let line = set[Math.floor(Math.random() * set.length)] || set[0]
  if (value && line.includes('{')) {
    line = line.replaceAll('{tool}', value).replaceAll('{target}', value).replaceAll('{t}', value)
  }
  return value && (kind === 'read' || kind === 'edit' || kind === 'search')
    ? `${line} ${value}`
    : line
}

// ── her faces (assets/faces/*.png, her own cut-ins from the show) ────────────────────────────

export const FACE = {
  idle: 'calm',
  sleep: 'calm',
  read: 'look',
  edit: 'look',
  search: 'look',
  run: 'smug',
  test: 'smug',
  build: 'smug',
  install: 'smug',
  commit: 'smug',
  push: 'smug',
  git: 'smug',
  web: 'smug',
  agent: 'smug',
  ask: 'many',
  alert: 'many',
  done: 'laugh',
  error: 'wide',
  think: 'aside',
  poke: 'smug',
  hello: 'smug',
}

export const TAG = {
  ru: { idle: 'НА СВЯЗИ', work: 'РАБОТА', alert: 'ТЫ НУЖЕН', done: 'ГОТОВО', error: 'ОШИБКА', sleep: 'СПИТ', think: 'ДУМАЕТ' },
  en: { idle: 'ONLINE', work: 'WORK', alert: 'YOU\'RE UP', done: 'DONE', error: 'ERROR', sleep: 'ASLEEP', think: 'THINKING' },
}
