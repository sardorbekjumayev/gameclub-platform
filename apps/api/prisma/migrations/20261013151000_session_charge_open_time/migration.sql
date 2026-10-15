-- VIP / ochiq vaqt yakunidagi hisob: session_charges.type += OPEN_TIME
ALTER TABLE "session_charges" DROP CONSTRAINT session_charges_type_chk;
ALTER TABLE "session_charges" ADD CONSTRAINT session_charges_type_chk CHECK (type IN ('EXTENSION','OVERTIME','ADJUSTMENT','PRODUCT','OPEN_TIME'));
