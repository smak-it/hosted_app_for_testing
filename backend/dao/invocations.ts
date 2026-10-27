import type { TransactionSQL } from "bun";
import type { ActionResponse } from "../actions/definition";
export class InvocationsDao {
  constructor(private db: TransactionSQL) {}
  async lock(id: string) {
    await this.db`
      SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))
    `;
  }
  async receipt(id: string): Promise<ActionResponse | undefined> {
    const [row] = await this.db`
      SELECT result
      FROM rukie_invocations
      WHERE id = ${id}
    `;
    return row?.result;
  }
  async record(id: string, result: ActionResponse) {
    await this.db`
      INSERT INTO rukie_invocations (id, result)
      VALUES (${id}, ${result}::jsonb)
    `;
  }
}
