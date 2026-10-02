-- Xona sxemasi bezaklari: kirish, kassa, devor, yo'lak, TV, hojatxona — [{kind,x,y}]
ALTER TABLE "rooms" ADD COLUMN "decor" JSONB NOT NULL DEFAULT '[]';
