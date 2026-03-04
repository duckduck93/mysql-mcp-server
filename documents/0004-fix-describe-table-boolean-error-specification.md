# 0004-fix-describe-table-boolean-error-개발명세서

## 프로젝트 구조/설계
- `src/db.ts`: `Database` 클래스에서 `describeTable` 메서드의 SQL 쿼리 및 결과 가공 로직을 수정한다.
- `src/tools/describe_table.ts`: 해당 툴의 입출력 Zod 스키마를 확인하여 `db.ts`의 반환값과 일치하는지 점검한다.

## 개발명세

### 요구사항 1: `Database.describeTable` 수정
- `IS_NULLABLE='YES' as nullable` 쿼리 결과로 나오는 `0` 또는 `1`을 `boolean` 타입으로 변환한다.
- `src/db.ts`
  ```typescript
  async describeTable(table: string) {
    // ...
    const [columnsRes, tableRes] = await Promise.all([
      this.queryRows(columnSql, [table]),
      this.queryRows(tableSql, [table])
    ]);
    const tableComment = (tableRes.rows as any[])[0]?.comment as string | undefined;
    // nullable 필드를 boolean으로 명시적 변환
    const columns = columnsRes.rows.map((row: any) => ({
      ...row,
      nullable: !!row.nullable,
    }));
    return { table, columns, tableComment };
  }
  ```

### 요구사항 2: 테스트 강화
- 기존 `tests/tools/describe_table.test.ts` 또는 새로운 테스트 파일을 통해 `nullable` 필드가 `boolean`으로 정상적으로 반환되는지 검증한다.
- `vitest`를 사용하여 테스트를 실행하고, 커버리지가 100%인지 확인한다.
