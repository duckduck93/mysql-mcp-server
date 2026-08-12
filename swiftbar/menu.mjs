// SwiftBar 메뉴바 플러그인의 알맹이. 렌더링과 동작을 함께 맡는다.
//
//   node menu.mjs                      메뉴를 그린다 (SwiftBar 가 stdout 을 읽는다)
//   node menu.mjs open  <이름> [분]     연다. 분을 주면 그때 만료된다
//   node menu.mjs close <이름>          닫는다
//   node menu.mjs use   <이름>          활성 프로파일을 바꾼다 (/mcp 재접속 필요)
//
// 열림 판정은 서버와 같은 코드(dist/profile-registry.js)를 쓴다. 따로 계산하면
// 메뉴에 보이는 것과 실제 차단이 어긋난다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PROFILES = path.join(REPO, 'profiles.json');
const STATE = path.join(REPO, '.swiftbar-state.json');
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

/** 운영을 열 때 고를 수 있는 시간. 짧은 것이 먼저 나와 실수로 긴 걸 누를 확률을 줄인다. */
const DURATIONS = [
  { minutes: 15, label: '15분' },
  { minutes: 60, label: '1시간' },
  { minutes: 240, label: '4시간' },
];

const [, , action, name, arg] = process.argv;

function readProfilesRaw() {
  return JSON.parse(fs.readFileSync(PROFILES, 'utf8'));
}

function writeProfilesRaw(raw) {
  fs.writeFileSync(PROFILES, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
}

function notify(title, message) {
  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
  execFile('/usr/bin/osascript', ['-e', script], () => {});
}

// ── 동작 ────────────────────────────────────────────────────────────────

if (action === 'open' || action === 'close') {
  const raw = readProfilesRaw();
  const target = raw[name];
  if (!target) process.exit(1);

  if (action === 'close') {
    if ('enabledUntil' in target) target.enabledUntil = null;
    else target.enabled = false;
  } else if ('enabledUntil' in target) {
    const minutes = Number(arg ?? DURATIONS[0].minutes);
    target.enabledUntil = new Date(Date.now() + minutes * 60_000).toISOString();
  } else {
    target.enabled = true;
  }
  writeProfilesRaw(raw);
  process.exit(0);
}

if (action === 'use') {
  const conf = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'));
  const entry = conf.mcpServers?.['mysql-mcp-server'];
  if (!entry) process.exit(1);
  entry.env.MYSQL_PROFILE = name;
  fs.writeFileSync(CLAUDE_JSON, JSON.stringify(conf, null, 2));
  notify('mysql-mcp', `활성 프로파일을 ${name} 로 바꿨습니다. /mcp 로 재접속하세요.`);
  process.exit(0);
}

// ── 렌더링 ──────────────────────────────────────────────────────────────

const self = fileURLToPath(import.meta.url);
const node = process.execPath;

/** SwiftBar 가 이 스크립트를 다시 부르게 하는 클릭 동작. */
function click(...params) {
  const parts = [`bash=${node}`, `param1=${self}`];
  params.forEach((p, i) => parts.push(`param${i + 2}=${p}`));
  parts.push('terminal=false', 'refresh=true');
  return parts.join(' ');
}

function remaining(until, now) {
  const ms = until.getTime() - now.getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}`;
  const seconds = Math.max(0, Math.floor(ms / 1000) % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function fail(lines) {
  console.log('⚠️');
  console.log('---');
  lines.forEach(l => console.log(l));
  console.log(`profiles.json 편집 | bash=/usr/bin/open param1=-t param2=${PROFILES} terminal=false`);
  process.exit(0);
}

let registry;
try {
  ({ ProfileRegistry: registry } = await import(path.join(REPO, 'dist/profile-registry.js')));
} catch {
  fail(['dist 가 없습니다. 저장소에서 npm run build 를 실행하세요.']);
}

let profiles;
try {
  const reg = registry.atPath(PROFILES);
  profiles = reg.names().map(n => reg.get(n));
} catch (e) {
  fail([`profiles.json 을 읽지 못했습니다 | color=red`, `${e.message.slice(0, 120)} | color=red`]);
}

let active = '(알 수 없음)';
try {
  active = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'))
    .mcpServers?.['mysql-mcp-server']?.env?.MYSQL_PROFILE ?? '(설정 없음)';
} catch {}

const now = new Date();
const open = profiles.filter(p => p.isOpenAt(now));
const openGated = open.filter(p => p.isGated);

// 메뉴바는 평소 한 글자로 둔다. 노치 모델에서 상주 아이콘이 밀리기 때문이다.
if (openGated.length === 0) {
  console.log('⚪');
} else {
  const soonest = openGated.reduce((a, b) => (a.expiresAt < b.expiresAt ? a : b));
  console.log(`🔴 ${soonest.name} ${remaining(soonest.expiresAt, now)}`);
}

console.log('---');
console.log(`활성 프로파일: ${active} | color=#888888`);
console.log('---');

for (const p of profiles) {
  const isOpen = p.isOpenAt(now);
  const until = p.expiresAt ? `  ~${remaining(p.expiresAt, now)}` : '';

  if (isOpen) {
    // 닫는 것은 한 번의 클릭으로. 급할 때 빨라야 한다.
    console.log(`● ${p.name}${until} — 닫기 | ${click('close', p.name)}`);
  } else if (p.isGated) {
    // 여는 것은 두 번의 클릭 + 시간 선택으로. 실수로 열리는 것을 막는다.
    console.log(`○ ${p.name} — 열기`);
    for (const d of DURATIONS) {
      console.log(`-- ${d.label} | ${click('open', p.name, String(d.minutes))}`);
    }
  } else {
    console.log(`○ ${p.name} — 열기 | ${click('open', p.name)}`);
  }
  console.log(`-- ${p.description} | color=#888888`);
  if (p.name !== active) {
    console.log(`-- 이 프로파일을 활성으로 | ${click('use', p.name)}`);
    console.log('-- (바꾸면 Claude Code 에서 /mcp 재접속 필요) | color=#888888 size=11');
  }
}

console.log('---');
console.log(`profiles.json 편집 | bash=/usr/bin/open param1=-t param2=${PROFILES} terminal=false`);
console.log('새로고침 | refresh=true');

// ── 상태 변화 알림 ──────────────────────────────────────────────────────
// 메뉴바는 풀스크린이나 아이콘 과밀 때 가려지므로 중요한 순간은 알림이 받는다.
let previous = {};
try { previous = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}

const next = {};
for (const p of profiles.filter(x => x.isGated)) {
  const isOpen = p.isOpenAt(now);
  const before = previous[p.name] ?? { open: false, warned: false };
  const minutesLeft = p.expiresAt ? (p.expiresAt.getTime() - now.getTime()) / 60_000 : 0;

  if (isOpen && !before.open) notify('mysql-mcp', `${p.name} 이 열렸습니다. ${remaining(p.expiresAt, now)} 뒤 닫힙니다.`);
  if (!isOpen && before.open) notify('mysql-mcp', `${p.name} 이 만료되어 닫혔습니다.`);

  const warned = isOpen && minutesLeft <= 5;
  if (warned && !before.warned && isOpen) notify('mysql-mcp', `${p.name} 이 곧 닫힙니다 (${remaining(p.expiresAt, now)}).`);

  next[p.name] = { open: isOpen, warned: isOpen ? (before.warned || warned) : false };
}
try { fs.writeFileSync(STATE, JSON.stringify(next)); } catch {}
