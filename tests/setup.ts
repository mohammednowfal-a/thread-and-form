process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://tf:tf_dev_pw@localhost:5432/threadform_test?schema=public";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify";
process.env.STOREFRONT_TENANT_SLUG = "tenant-a";
process.env.WHATSAPP_PHONE_NUMBER_ID = "";
process.env.WHATSAPP_ACCESS_TOKEN = "";
