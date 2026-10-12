// A recording script, as an agent would write it, for the demo app.
// Signs in with the demo button (no password), then uses the app.
export default async (page: any) => {
  if (page.url().includes("/login")) {
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.startsWith("/login")), page.click("#demo")]);
  }
  await page.waitForSelector("#list li");
  for (const name of ["Ada Demo", "Linus Sample"]) {
    await Promise.all([page.waitForResponse((r: any) => r.url().includes("leave-requests")), page.click(`text=${name}`)]);
  }
  await Promise.all([page.waitForResponse((r: any) => r.url().includes("status=inactive")), page.selectOption("#status", "inactive")]);
};
