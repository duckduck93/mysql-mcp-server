# 작업번호: 0004 — Docker 컨테이너 내 MySQL 접속 실패(show_tables 오류) 원인 분석 및 수정 요구사항 정의서

## 배경
사용자는 `mysql-mcp-server` 컨테이너 실행 시 `show_tables` 호출에서 오류가 발생한다고 보고했습니다. 로그 상 `mysql2`의 `PromisePool.execute` 단계에서 예외가 발생하며, MCP 서버는 에러 메시지 없이 빈 문자열을 반환하는 것으로 관찰되었습니다.

오류 로그 발췌:

```
tool show_tables failed:
input: {"includeViews":false}
stack: Error
    at PromisePool.execute (...)
    at Database.queryRows (.../dist/db.js:41:35)
    at Database.showTables (.../dist/db.js:61:37)
    ...
```

컨테이너 실행 설정에서는 `MYSQL_HOST=localhost`로 지정되어 있습니다.

```
docker run -e MYSQL_HOST=localhost -e MYSQL_PORT=3306 ... mysql-mcp-server
```

## 문제 정의
- Docker 컨테이너 내부에서 `localhost`/`127.0.0.1`은 컨테이너 자신을 가리키므로, 호스트 머신에서 실행 중인 MySQL 서버에 연결하려 할 경우 접속이 실패합니다.
- 따라서 `show_tables`를 포함한 모든 DB 작업이 실패할 수 있습니다.
- 실패 시 로깅이 충분하지 않아(메시지 공백 등) 원인 파악이 어려울 수 있습니다.

## 목표
1. 컨테이너 내부에서 `MYSQL_HOST`가 `localhost` 또는 `127.0.0.1`로 설정된 경우, 합리적인 기본값으로 호스트 접근이 가능하도록 자동 보정하거나, 이를 제어할 수 있는 환경변수를 제공합니다.
2. 실패 시 에러 로깅을 보강하여 원인 파악이 용이하도록 합니다.
3. 기존 동작과의 호환성을 유지하고, 로컬(비-Docker) 환경에는 영향이 없도록 합니다.

## 범위
- 환경설정 로딩(`src/config.ts`) 개선
- `show_tables` 툴의 에러 로깅 보강
- 문서화(요구사항/명세서)
- 단위 테스트 추가(설정 분기 동작 검증)

## 요구사항
- R1. Docker 컨테이너 내부에서 `MYSQL_HOST`가 `localhost` 또는 `127.0.0.1`이면 기본적으로 `host.docker.internal`로 리라이트한다.
  - R1-1. 단, `MYSQL_HOST_RESOLVE=off`이면 리라이트를 수행하지 않는다.
  - R1-2. `MYSQL_HOST_DOCKER`가 정의된 경우, 리라이트 대상 호스트는 해당 값으로 한다.
  - R1-3. `MYSQL_IN_DOCKER` 값이 `1/true/yes`이면 Docker 환경으로 간주, `0/false/no`이면 비-Docker로 간주한다. (테스트 및 제어 용도)
- R2. `show_tables` 실패 시, 오류 메시지 외에 `code`, `errno`, `sql`, `sqlState`, `sqlMessage` 등 MySQL 관련 세부 정보를 함께 로깅한다.
- R3. 변경은 비파괴적으로 기존 환경 변수와 호환되어야 한다.

## 비기능 요구사항
- NFR1. 변경 후에도 전체 테스트가 통과할 것.
- NFR2. 향후 디버깅이 용이하도록 에러 로깅 메시지는 시간, 입력값, 세부정보를 포함한다.

## 수용 기준
- AC1. 컨테이너에서 `MYSQL_HOST=localhost`로 실행할 때, MySQL이 호스트 머신에서 동작 중이라면 정상적으로 `show_tables`가 성공한다.
- AC2. 의도적으로 접속이 실패하는 경우, stderr 로그에 에러 코드/메시지 등의 세부 정보가 출력된다.
- AC3. `MYSQL_HOST_RESOLVE=off` 설정 시 어떠한 자동 리라이트도 발생하지 않는다.
- AC4. 테스트(설정 분기) 통과.
