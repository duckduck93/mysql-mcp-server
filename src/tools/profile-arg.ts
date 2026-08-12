import { z } from 'zod';

export type ProfileChoice = { name: string; description: string };

/**
 * 모든 도구가 공유하는 `profile` 인자.
 *
 * **기본값을 두지 않는다.** 기본값이 있으면 Agent 가 고르지 않고 흘려보낸다.
 * enum 후보에 각 프로파일의 설명을 그대로 실어, 그것을 근거로 고르게 한다.
 *
 * 후보는 서버가 뜰 때 정해진다. 프로파일을 새로 추가하면 `/mcp` 재접속을 해야 목록에 잡힌다.
 * 여닫는 것은 파일을 매 호출 다시 읽으므로 재접속이 필요 없다.
 */
export function profileArg(choices: ProfileChoice[]) {
  const names = choices.map(c => c.name);
  const guide = choices.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const description =
    '어느 DB 에 물을지 고른다. 필수이며 임의로 정하지 말고 아래 설명을 근거로 고른다. ' +
    '어느 것이 열려 있는지 모르면 profiles 도구를 먼저 부른다.\n' +
    guide;

  // 프로파일이 하나도 없으면 기동 자체가 실패하므로 enum 은 항상 비어 있지 않다.
  return z.enum(names as [string, ...string[]]).describe(description);
}
