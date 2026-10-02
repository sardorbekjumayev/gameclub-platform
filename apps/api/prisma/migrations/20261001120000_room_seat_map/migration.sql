-- Xona sxemasi (o'rindiq tanlash): xona grid o'lchami; qurilma joyi devices.layout {x,y} da
ALTER TABLE "rooms" ADD COLUMN "grid_cols" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "rooms" ADD COLUMN "grid_rows" INTEGER NOT NULL DEFAULT 5;
