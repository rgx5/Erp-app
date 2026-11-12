export const PASSWORDS = { migrator: 'migrator_test_pw_1', app: 'app_test_pw_1' };

export function urlFor(base: string, user: string | undefined, password: string | undefined, database: string): string {
  const url = new URL(base);
  if (user !== undefined) url.username = user;
  if (password !== undefined) url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}
