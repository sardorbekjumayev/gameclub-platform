-- Kartaga o'tkazma to'lov usuli
ALTER TABLE "payments" DROP CONSTRAINT payments_method_chk;
ALTER TABLE "payments" ADD CONSTRAINT payments_method_chk CHECK (method IN ('ONLINE_CARD','WALLET','CASH','TERMINAL','CARD_TRANSFER'));
