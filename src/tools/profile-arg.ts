import { z } from 'zod';

export type ProfileChoice = { name: string; description: string };

/**
 * 모든 도구가 공유하는 `profile` 인자.
 *
 * **기본값을 두지 않는다.** 기본값이 있으면 Agent 가 고르지 않고 흘려보낸다.
 *
 * 후보를 `z.enum` 으로 굳히지 않고 문자열로 받는다. 도구 스키마는 세션 시작 때
 * 한 번 주고받은 뒤 바뀌지 않으므로, enum 으로 두면 프로파일을 추가할 때마다
 * 클라이언트가 앞단에서 막아 `/mcp` 재접속을 강제하게 된다. 이름 검증은 레지스트리가
 * 호출 시점에 하고, 틀리면 유효 목록을 함께 돌려준다.
 *
 * 설명에 싣는 후보 목록은 기동 시점 기준이라 오래됐을 수 있다. 그래서 목록이
 * 최신인지 확인하려면 `profiles` 도구를 부르라고 함께 적는다.
 */
export function profileArg(choices: ProfileChoice[]) {
  const guide = choices.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const description =
    '어느 DB 에 물을지 고른다. 필수이며 임의로 정하지 말고 아래 설명을 근거로 고른다.\n' +
    '아래 목록은 서버가 뜬 시점 기준이다. 어느 것이 열려 있는지, 그 사이 늘어난 것이 있는지는 ' +
    'profiles 도구로 확인한다. 목록에 없는 이름도 그대로 넘기면 되고, 없는 이름이면 ' +
    '유효한 목록과 함께 실패한다.\n' +
    guide;

  return z.string().min(1).describe(description);
}
