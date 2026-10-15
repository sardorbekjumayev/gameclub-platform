-- Klub hujjati endi o'z storage'imizga yuklanadi (files.purpose = CLUB_DOCUMENT); tashqi URL ham qoladi.
ALTER TABLE "club_documents" ADD COLUMN "file_id" UUID;
ALTER TABLE "club_documents" ALTER COLUMN "file_url" DROP NOT NULL;
