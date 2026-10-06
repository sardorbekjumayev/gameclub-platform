-- Mijoz to'g'ridan-to'g'ri klub egasining kartasiga o'tkazadi (CARD_TRANSFER); klub tasdiqlaydi.
ALTER TABLE "clubs" ADD COLUMN "transfer_card_number" TEXT;
ALTER TABLE "clubs" ADD COLUMN "transfer_card_holder" TEXT;
