// Operator recovery: reset the admin password directly in the database.
// Run where DATABASE_URL points at your database (e.g. Render Shell, or
// locally with DATABASE_URL set to the Neon connection string):
//
//   npm run admin:reset -- <admin-id> <new-password>
//
// Portfolio content is never touched. All sessions for that admin end.
import { initDb, db, audit } from '../server/db.js';
import { hashPassword, passwordProblems } from '../server/security.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: npm run admin:reset -- <admin-id> <new-password>');
  process.exit(1);
}
const problems = passwordProblems(password, { username });
if (problems.length) {
  console.error('Password rejected: ' + problems.join(' '));
  process.exit(1);
}
await initDb();
const { rows } = await db().query(
  'UPDATE admins SET pass_hash = $1, uses_default = FALSE, must_change = FALSE, updated_at = now() WHERE username = $2 RETURNING id',
  [hashPassword(password), username]
);
if (!rows[0]) {
  console.error(`No admin called "${username}".`);
  process.exit(1);
}
await db().query('DELETE FROM sessions WHERE admin_id = $1', [rows[0].id]);
await db().query(`UPDATE recovery_requests SET status = 'closed' WHERE username = $1 AND status = 'queued'`, [username]);
await audit('operator', 'auth.password_reset_by_operator', { username });
console.log(`Password for "${username}" updated. Sign in at /admin/.`);
await db().close();
