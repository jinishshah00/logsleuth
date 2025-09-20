-- CreateEnum
CREATE TYPE "public"."UploadStatus" AS ENUM ('RECEIVED', 'PARSING', 'PARSED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Upload" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "gcsUri" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."UploadStatus" NOT NULL DEFAULT 'RECEIVED',
    "totalRows" INTEGER,
    "parsedRows" INTEGER,
    "errorText" TEXT,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Event" (
    "id" SERIAL NOT NULL,
    "uploadId" TEXT NOT NULL,
    "ts" TIMESTAMPTZ(6),
    "srcIp" TEXT,
    "dstIp" TEXT,
    "userName" TEXT,
    "url" TEXT,
    "domain" TEXT,
    "method" TEXT,
    "status" INTEGER,
    "category" TEXT,
    "action" TEXT,
    "bytesIn" BIGINT,
    "bytesOut" BIGINT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "country" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "urlHost" TEXT,
    "urlPath" TEXT,
    "urlTld" TEXT,
    "hourBucket" TIMESTAMP(3),
    "dayBucket" TIMESTAMP(3),
    "extras" JSONB,
    "rawLine" TEXT NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Anomaly" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "eventId" INTEGER,
    "detector" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "Upload_uploadedAt_idx" ON "public"."Upload"("uploadedAt");

-- CreateIndex
CREATE INDEX "Upload_status_idx" ON "public"."Upload"("status");

-- CreateIndex
CREATE INDEX "Event_uploadId_ts_idx" ON "public"."Event"("uploadId", "ts");

-- CreateIndex
CREATE INDEX "Event_uploadId_srcIp_idx" ON "public"."Event"("uploadId", "srcIp");

-- CreateIndex
CREATE INDEX "Event_uploadId_domain_idx" ON "public"."Event"("uploadId", "domain");

-- CreateIndex
CREATE INDEX "Anomaly_uploadId_idx" ON "public"."Anomaly"("uploadId");

-- CreateIndex
CREATE INDEX "Anomaly_eventId_idx" ON "public"."Anomaly"("eventId");

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "public"."Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Anomaly" ADD CONSTRAINT "Anomaly_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "public"."Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Anomaly" ADD CONSTRAINT "Anomaly_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
