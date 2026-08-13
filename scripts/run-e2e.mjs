const required = ["TEST_SUPABASE_URL", "TEST_SUPABASE_PUBLISHABLE_KEY"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.log(`E2E übersprungen: separate Testkonfiguration fehlt (${missing.join(", ")}).`);
  process.exit(0);
}

console.error("E2E nicht gestartet: Playwright ist noch nicht installiert. Produktionsdaten werden nicht als Ersatz verwendet.");
process.exit(2);
