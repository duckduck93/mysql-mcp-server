# 작업번호: 0004 — Docker 컨테이너 내 MySQL 접속 실패(show_tables 오류) 개발 명세서

본 문서는 요구사항정의서(0004-docker-host-remap-requirements.md)를 바탕으로 구현 상세를 기술합니다.

## 개요
- 컨테이너 내부에서 `MYSQL_HOST=localhost` 등으로 설정될 경우 호스트 머신의 MySQL 서버에 접속하지 못하는 문제를 자동 보정합니다.
- 실패 시 로깅을 보강하여 원인 분석을 용이하게 합니다.

## 변경 사항 요약
1. 설정 로더(`src/config.ts`)
   - Docker 환경 감지 로직 추가:
     - 우선순위 1: `MYSQL_IN_DOCKER` 환경변수로 명시 제어 (값: `1/true/yes` → docker, `0/false/no` → non-docker)
     - 우선순위 2: `/.dockerenv` 존재 여부
     - 우선순위 3: `/proc/1/cgroup` 존재 여부 (간소화, 존재 시 컨테이너로 간주)
     - 우선순위 4: `/run/dockershim.sock` 존재 여부
   - 호스트 리라이트 규칙:
     - 조건: (도커환경) AND (`MYSQL_HOST` in {`localhost`, `127.0.0.1`}) AND (`MYSQL_HOST_RESOLVE` != `off`)
     - 결과: `MYSQL_HOST = MYSQL_HOST_DOCKER || 'host.docker.internal'`
   - 그 외 기존 필드 파싱/SSL 로직은 변경 없음.

2. `show_tables` 도구(`src/tools/show_tables.ts`)
   - 에러 로깅 보강: `code`, `errno`, `sql`, `sqlState`, `sqlMessage` 등 세부정보를 `details`로 함께 기록
   - 메시지가 비어있는 경우 `sqlMessage` 또는 `code`를 보강 메시지로 노출

## 비호환성 여부
- 없음. 기본값은 `MYSQL_HOST_RESOLVE=auto`로, 기존 설정과 호환됩니다.
- 옵트아웃: `MYSQL_HOST_RESOLVE=off`
- 명시 강제: `MYSQL_IN_DOCKER=1` 또는 `0`

## 환경 변수 요약
- `MYSQL_HOST_RESOLVE`: `auto`(기본) | `off`
- `MYSQL_IN_DOCKER`: `1/true/yes` → Docker, `0/false/no` → Non-Docker
- `MYSQL_HOST_DOCKER`: 리라이트 대상 호스트 오버라이드(기본: `host.docker.internal`)

## 수용 테스트 시나리오
1. 컨테이너 내부(또는 `MYSQL_IN_DOCKER=1`)에서 `MYSQL_HOST=localhost`로 실행 → 자동으로 `host.docker.internal`로 리라이트되어 DB 접속 성공.
2. 위 상황에서 `MYSQL_HOST_RESOLVE=off` 설정 → 리라이트 없이 `localhost` 유지(의도대로 실패 가능), 로그에 세부 에러 정보 출력.
3. `MYSQL_HOST_DOCKER=docker.host.example` 설정 시 해당 값으로 리라이트.
4. 실패 시 stderr 로그에 시간/입력/세부정보(details)/스택이 출력됨.

## 테스트
- `tests/config.test.ts`: 환경변수 기반 리라이트/옵트아웃/오버라이드 확인.
- `tests/config.fs-detect.test.ts`: 파일 시스템 기반 도커 감지 경로 확인.
- `tests/tools/show_tables.test.ts`: 에러 로깅 세부정보 및 메시지 보강 동작 확인.
- 기존 테스트군은 변경 없이 통과해야 함.

## 배포/빌드
- Dockerfile은 빌드 결과물(`/dist`)만 포함하므로, 빌드 후 이미지 재생성 필요.
  - 예: `docker build -t mysql-mcp-server .`

## 운영 가이드
- 호스트 머신의 MySQL에 접속하려면 다음과 같이 실행을 권장합니다.

```json
{
  "mcpServers": {
    "mysql-mcp-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MYSQL_HOST=localhost",
        "-e", "MYSQL_PORT=3306",
        "-e", "MYSQL_USER=test_user",
        "-e", "MYSQL_PASSWORD=sample_pass_123",
        "-e", "MYSQL_DATABASE=test_db",
        "-e", "MYSQL_IN_DOCKER=1",
        "-e", "MYSQL_HOST_RESOLVE=auto",
        "mysql-mcp-server"
      ]
    }
  }
}
```

필요 시 `MYSQL_HOST_DOCKER`로 `host.docker.internal` 대신 다른 호스트명을 지정할 수 있습니다.
