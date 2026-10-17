-- Rozilik (consents): ommaviy ofertaga (OFFER) rozilik berishni ham qo'llab-quvvatlash.
-- Mijozga ko'rsatiladigan rozilik hujjatlari: OFFER, PRIVACY, TERMS (docs/02-DATABASE.md §3.1).
ALTER TABLE "consents" DROP CONSTRAINT IF EXISTS consents_doc_chk;
ALTER TABLE "consents" ADD CONSTRAINT consents_doc_chk CHECK (document_type IN ('TERMS', 'PRIVACY', 'OFFER'));
