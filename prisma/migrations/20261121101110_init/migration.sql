-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF', 'VIEWER');

-- CreateEnum
CREATE TYPE "BrandAssetKind" AS ENUM ('LOGO', 'MASCOT_ATI', 'MASCOT_ATO', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "RoastStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RoastEventType" AS ENUM ('CHARGE', 'TURNING_POINT', 'DRY_END', 'FC_START', 'FC_END', 'SC_START', 'DROP', 'HEAT_CHANGE', 'AIRFLOW_CHANGE', 'DRUM_CHANGE', 'NOTE');

-- CreateEnum
CREATE TYPE "CurveSource" AS ENUM ('MANUAL', 'CSV', 'ARTISAN_ALOG');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('GRINDER', 'DRIPPER', 'FILTER', 'KETTLE', 'SCALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('PLANNING', 'RUNNING', 'CONCLUDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InventoryKind" AS ENUM ('GREEN', 'ROASTED', 'FINISHED', 'MATERIAL');

-- CreateEnum
CREATE TYPE "InventoryUnit" AS ENUM ('G', 'PCS');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('AVAILABLE', 'QUARANTINE', 'HOLD', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "InventoryTxType" AS ENUM ('RECEIPT', 'ROAST_ISSUE', 'ROAST_OUTPUT', 'CUPPING_USE', 'TASTING_USE', 'SAMPLE_GIFT', 'PACKAGING_ISSUE', 'PACKAGING_LOSS', 'PACKAGING_OUTPUT', 'MATERIAL_ISSUE', 'SCRAP', 'ADJUSTMENT', 'SHIPMENT_ISSUE', 'RETURN_QUARANTINE', 'RETURN_RESTOCK_OUT', 'RETURN_RESTOCK_IN', 'REVERSAL');

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('BAG', 'LABEL', 'DRIP_BAG', 'BOX', 'SEAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "ReservationPurpose" AS ENUM ('ORDER', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionMode" AS ENUM ('PRE_PACK', 'MADE_TO_ORDER');

-- CreateEnum
CREATE TYPE "QualityStatus" AS ENUM ('PASS', 'HOLD', 'FAIL');

-- CreateEnum
CREATE TYPE "ConsumptionKind" AS ENUM ('BEANS', 'LOSS', 'MATERIAL');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('COFFEE_BEAN', 'DRIP_BAG', 'DRIP_BAG_SET', 'GIFT_BOX', 'MERCH', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StockPolicy" AS ENUM ('STOCK_ONLY', 'MADE_TO_ORDER', 'NOT_TRACKED');

-- CreateEnum
CREATE TYPE "SeriesCharacter" AS ENUM ('NONE', 'ATI', 'ATO', 'BOTH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING_CONFIRMATION', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'AWAITING_PACKAGING', 'READY_TO_SHIP', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'RETURN_PROCESSING');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('MANUAL', 'WEB', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE', 'NONE');

-- CreateEnum
CREATE TYPE "FulfillmentMode" AS ENUM ('STOCK', 'MADE_TO_ORDER', 'NOT_TRACKED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('RESERVED', 'SHIPPED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('PENDING_INSPECTION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('RESTOCK', 'SCRAP');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('ROAST_ENERGY', 'ROAST_LABOR', 'PACKAGING_LABOR', 'CONSUMABLES', 'SHIPPING', 'PLATFORM_FEE', 'PAYMENT_FEE', 'ORDER_OTHER', 'OPERATING_EXPENSE');

-- CreateEnum
CREATE TYPE "CostTarget" AS ENUM ('ROAST_BATCH', 'PRODUCTION_ORDER', 'SALES_ORDER', 'PERIOD');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandAsset" (
    "id" UUID NOT NULL,
    "kind" "BrandAssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "country" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coffee" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT,
    "brandName" TEXT,
    "country" TEXT,
    "region" TEXT,
    "farm" TEXT,
    "producer" TEXT,
    "variety" TEXT,
    "process" TEXT,
    "altitude" TEXT,
    "grade" TEXT,
    "supplierId" UUID,
    "originFlavorNotes" TEXT,
    "imageKey" TEXT,
    "note" TEXT,
    "restStartDays" INTEGER,
    "peakFromDays" INTEGER,
    "peakToDays" INTEGER,
    "shelfLifeDays" INTEGER,
    "freshnessNote" TEXT,
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Coffee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GreenBeanPurchase" (
    "id" UUID NOT NULL,
    "purchaseNo" TEXT NOT NULL,
    "supplierId" UUID,
    "purchaseDate" DATE NOT NULL,
    "invoiceNo" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GreenBeanPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GreenBeanLot" (
    "id" UUID NOT NULL,
    "lotCode" TEXT NOT NULL,
    "purchaseId" UUID NOT NULL,
    "coffeeId" UUID NOT NULL,
    "purchasedWeightG" DECIMAL(14,3) NOT NULL,
    "unitPricePerKg" DECIMAL(14,2) NOT NULL,
    "shippingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "receivedWeightG" DECIMAL(14,3) NOT NULL,
    "costPerG" DECIMAL(18,6) NOT NULL,
    "moisturePercent" DECIMAL(5,2),
    "densityGPerL" DECIMAL(8,2),
    "waterActivity" DECIMAL(4,3),
    "locationId" UUID,
    "note" TEXT,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GreenBeanLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoasterProfile" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "maxCapacityG" DECIMAL(10,1),
    "sensorConfig" JSONB,
    "tempChannels" TEXT[],
    "heatControl" TEXT,
    "airflowControl" TEXT,
    "drumSpeedControl" TEXT,
    "customFieldsSpec" JSONB,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RoasterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoastBatch" (
    "id" UUID NOT NULL,
    "batchNo" TEXT NOT NULL,
    "greenLotId" UUID NOT NULL,
    "roasterId" UUID NOT NULL,
    "roastedAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "RoastStatus" NOT NULL DEFAULT 'POSTED',
    "greenWeightG" DECIMAL(14,3) NOT NULL,
    "roastedWeightG" DECIMAL(14,3) NOT NULL,
    "weightLossPercent" DECIMAL(6,3) NOT NULL,
    "chargeTempC" DECIMAL(6,1),
    "turningPointSec" INTEGER,
    "turningPointTempC" DECIMAL(6,1),
    "dryEndSec" INTEGER,
    "firstCrackStartSec" INTEGER,
    "firstCrackEndSec" INTEGER,
    "dropSec" INTEGER,
    "dropTempC" DECIMAL(6,1),
    "totalTimeSec" INTEGER,
    "dryingPhaseSec" INTEGER,
    "maillardPhaseSec" INTEGER,
    "developmentPhaseSec" INTEGER,
    "dtrPercent" DECIMAL(6,3),
    "roastLevel" TEXT,
    "targetProfile" TEXT,
    "result" TEXT,
    "qualityRating" INTEGER,
    "note" TEXT,
    "customFields" JSONB,
    "restStartDays" INTEGER,
    "peakFromDays" INTEGER,
    "peakToDays" INTEGER,
    "shelfLifeDays" INTEGER,
    "greenCostTotal" DECIMAL(14,2) NOT NULL,
    "copiedFromId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RoastBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoastEvent" (
    "id" UUID NOT NULL,
    "roastBatchId" UUID NOT NULL,
    "timeSec" INTEGER NOT NULL,
    "type" "RoastEventType" NOT NULL,
    "btC" DECIMAL(6,1),
    "etC" DECIMAL(6,1),
    "rorC" DECIMAL(6,2),
    "heat" TEXT,
    "airflow" TEXT,
    "drumSpeed" TEXT,
    "note" TEXT,

    CONSTRAINT "RoastEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoastCurve" (
    "id" UUID NOT NULL,
    "roastBatchId" UUID NOT NULL,
    "source" "CurveSource" NOT NULL,
    "originalFileName" TEXT,
    "storageKey" TEXT,
    "fileSha256" TEXT,
    "columnMapping" JSONB,
    "pointCount" INTEGER NOT NULL,
    "rorComputed" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "importedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoastCurve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoastCurvePoint" (
    "id" UUID NOT NULL,
    "curveId" UUID NOT NULL,
    "timeSec" DECIMAL(9,2) NOT NULL,
    "btC" DECIMAL(6,1),
    "etC" DECIMAL(6,1),
    "rorC" DECIMAL(7,2),
    "heat" DECIMAL(7,2),
    "airflow" DECIMAL(7,2),
    "drumSpeed" DECIMAL(7,2),
    "extra" JSONB,

    CONSTRAINT "RoastCurvePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlavorTag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "color" TEXT,

    CONSTRAINT "FlavorTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuppingTemplate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scaleMin" DECIMAL(5,2) NOT NULL,
    "scaleMax" DECIMAL(5,2) NOT NULL,
    "step" DECIMAL(4,2) NOT NULL,
    "attributes" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuppingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuppingSession" (
    "id" UUID NOT NULL,
    "roastBatchId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "cuppedAt" TIMESTAMPTZ(6) NOT NULL,
    "restDays" INTEGER NOT NULL,
    "grindSetting" TEXT,
    "doseG" DECIMAL(8,2),
    "waterG" DECIMAL(8,2),
    "waterTempC" DECIMAL(5,1),
    "totalScore" DECIMAL(6,2),
    "defects" TEXT,
    "description" TEXT,
    "evaluator" TEXT,
    "imageKey" TEXT,
    "consumedG" DECIMAL(10,3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuppingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuppingScore" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "attributeKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "CuppingScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuppingSessionTag" (
    "sessionId" UUID NOT NULL,
    "flavorTagId" UUID NOT NULL,

    CONSTRAINT "CuppingSessionTag_pkey" PRIMARY KEY ("sessionId","flavorTagId")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" UUID NOT NULL,
    "type" "EquipmentType" NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrewRecipe" (
    "id" UUID NOT NULL,
    "rootId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "coffeeId" UUID,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "grinderId" UUID,
    "grindSetting" TEXT,
    "dripperId" UUID,
    "filterId" UUID,
    "doseG" DECIMAL(8,2) NOT NULL,
    "waterG" DECIMAL(8,2) NOT NULL,
    "waterTempC" DECIMAL(5,1),
    "bloomWaterG" DECIMAL(8,2),
    "bloomTimeSec" INTEGER,
    "totalTimeSec" INTEGER,
    "pourMethod" TEXT,
    "agitation" TEXT,
    "pourPlan" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrewRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrewSession" (
    "id" UUID NOT NULL,
    "roastBatchId" UUID NOT NULL,
    "recipeId" UUID,
    "brewedAt" TIMESTAMPTZ(6) NOT NULL,
    "restDays" INTEGER NOT NULL,
    "grinderId" UUID,
    "grindSetting" TEXT,
    "dripperId" UUID,
    "filterId" UUID,
    "doseG" DECIMAL(8,2) NOT NULL,
    "waterG" DECIMAL(8,2) NOT NULL,
    "ratio" DECIMAL(6,2) NOT NULL,
    "waterTempC" DECIMAL(5,1),
    "waterQuality" TEXT,
    "tdsPercent" DECIMAL(5,2),
    "extractionPercent" DECIMAL(5,2),
    "totalTimeSec" INTEGER,
    "bloomTimeSec" INTEGER,
    "bloomWaterG" DECIMAL(8,2),
    "pourMethod" TEXT,
    "flowRateGPerSec" DECIMAL(5,2),
    "agitation" TEXT,
    "flavorNotes" TEXT,
    "rating" DECIMAL(4,1),
    "note" TEXT,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrewPourStep" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "startSec" INTEGER,
    "endSec" INTEGER,
    "waterG" DECIMAL(8,2) NOT NULL,
    "cumulativeG" DECIMAL(8,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "BrewPourStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrewSessionTag" (
    "sessionId" UUID NOT NULL,
    "flavorTagId" UUID NOT NULL,

    CONSTRAINT "BrewSessionTag_pkey" PRIMARY KEY ("sessionId","flavorTagId")
);

-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT,
    "objective" TEXT,
    "controlledVariables" TEXT,
    "independentVariables" TEXT,
    "status" "ResearchStatus" NOT NULL DEFAULT 'PLANNING',
    "startDate" DATE,
    "result" TEXT,
    "conclusion" TEXT,
    "nextSteps" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchExperiment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "experimentDate" DATE NOT NULL,
    "variableValues" JSONB,
    "observation" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchExperimentLink" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "roastBatchId" UUID,
    "cuppingSessionId" UUID,
    "brewSessionId" UUID,

    CONSTRAINT "ResearchExperimentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MaterialCategory" NOT NULL,
    "spec" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "kind" "InventoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "coffeeId" UUID,
    "productVariantId" UUID,
    "materialId" UUID,
    "lowStockThreshold" DECIMAL(14,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "lotCode" TEXT NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "onHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "locationId" UUID,
    "greenLotId" UUID,
    "roastBatchId" UUID,
    "packagingBatchId" UUID,
    "returnSourceLotId" UUID,
    "producedAt" TIMESTAMPTZ(6),
    "bestByDate" DATE,
    "expiryDate" DATE,
    "expirySource" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "idempotencyKey" TEXT,
    "itemId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "type" "InventoryTxType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "InventoryUnit" NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "balanceAfter" DECIMAL(14,3) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "actorId" UUID,
    "reversesId" UUID,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "purpose" "ReservationPurpose" NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "salesOrderItemId" UUID,
    "productionOrderId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(6),
    "consumedAt" TIMESTAMPTZ(6),

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "mode" "ProductionMode" NOT NULL,
    "status" "ProductionStatus" NOT NULL DEFAULT 'PLANNED',
    "sourceLotId" UUID NOT NULL,
    "targetVariantId" UUID NOT NULL,
    "plannedQty" INTEGER NOT NULL,
    "actualQty" INTEGER,
    "fillWeightG" DECIMAL(10,3) NOT NULL,
    "beansConsumedG" DECIMAL(14,3),
    "lossG" DECIMAL(14,3),
    "laborCost" DECIMAL(14,2),
    "salesOrderItemId" UUID,
    "plannedDate" DATE NOT NULL,
    "qualityStatus" "QualityStatus" NOT NULL DEFAULT 'PASS',
    "note" TEXT,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionConsumption" (
    "id" UUID NOT NULL,
    "productionOrderId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "kind" "ConsumptionKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ProductionConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingBatch" (
    "id" UUID NOT NULL,
    "batchNo" TEXT NOT NULL,
    "productionOrderId" UUID NOT NULL,
    "packagedAt" TIMESTAMPTZ(6) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "bestByDate" DATE,
    "expiryDate" DATE,
    "expirySource" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandSeries" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "story" TEXT,
    "flavorNotes" TEXT,
    "character" "SeriesCharacter" NOT NULL DEFAULT 'NONE',
    "isLimited" BOOLEAN NOT NULL DEFAULT false,
    "launchDate" DATE,
    "imageKey" TEXT,
    "recommendedRecipeId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BrandSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "brandSeriesId" UUID,
    "coffeeId" UUID,
    "description" TEXT,
    "flavorNotes" TEXT,
    "imageKey" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "isLimited" BOOLEAN NOT NULL DEFAULT false,
    "saleStartDate" DATE,
    "saleEndDate" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listPrice" DECIMAL(14,2) NOT NULL,
    "salePrice" DECIMAL(14,2) NOT NULL,
    "standardCost" DECIMAL(14,2),
    "fillWeightG" DECIMAL(10,3),
    "isBundle" BOOLEAN NOT NULL DEFAULT false,
    "stockPolicy" "StockPolicy" NOT NULL DEFAULT 'STOCK_ONLY',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBundleComponent" (
    "id" UUID NOT NULL,
    "bundleVariantId" UUID NOT NULL,
    "componentVariantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ProductBundleComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantMaterial" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "quantityPerUnit" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "VariantMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "channel" "OrderChannel" NOT NULL DEFAULT 'MANUAL',
    "externalRef" TEXT,
    "idempotencyKey" TEXT,
    "customerId" UUID,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "shippingAddress" TEXT,
    "orderedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "taxMode" "TaxMode" NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "refundedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingMethod" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceSnapshot" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "costSnapshot" DECIMAL(14,2),
    "isBundle" BOOLEAN NOT NULL DEFAULT false,
    "fulfillmentMode" "FulfillmentMode" NOT NULL DEFAULT 'STOCK',

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderBatchAllocation" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderBatchAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" "PaymentType" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "method" TEXT,
    "carrier" TEXT,
    "trackingNo" TEXT,
    "shippingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippedAt" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRecord" (
    "id" UUID NOT NULL,
    "returnNo" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'PENDING_INSPECTION',
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ReturnRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "quarantineLotId" UUID NOT NULL,
    "disposition" "ReturnDisposition",
    "inspectedAt" TIMESTAMPTZ(6),
    "note" TEXT,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "target" "CostTarget" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "isEstimate" BOOLEAN NOT NULL DEFAULT false,
    "occurredOn" DATE NOT NULL,
    "roastBatchId" UUID,
    "productionOrderId" UUID,
    "salesOrderId" UUID,
    "allocationRuleId" UUID,
    "calcNote" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocationRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "method" TEXT NOT NULL,
    "rate" DECIMAL(14,4) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAllocationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTraceability" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "packagingBatchId" UUID NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "recommendedBrew" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductTraceability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Coffee_code_key" ON "Coffee"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GreenBeanPurchase_purchaseNo_key" ON "GreenBeanPurchase"("purchaseNo");

-- CreateIndex
CREATE UNIQUE INDEX "GreenBeanLot_lotCode_key" ON "GreenBeanLot"("lotCode");

-- CreateIndex
CREATE UNIQUE INDEX "RoasterProfile_name_key" ON "RoasterProfile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoastBatch_batchNo_key" ON "RoastBatch"("batchNo");

-- CreateIndex
CREATE INDEX "RoastBatch_roastedAt_idx" ON "RoastBatch"("roastedAt");

-- CreateIndex
CREATE INDEX "RoastEvent_roastBatchId_timeSec_idx" ON "RoastEvent"("roastBatchId", "timeSec");

-- CreateIndex
CREATE UNIQUE INDEX "RoastCurve_roastBatchId_fileSha256_key" ON "RoastCurve"("roastBatchId", "fileSha256");

-- CreateIndex
CREATE INDEX "RoastCurvePoint_curveId_timeSec_idx" ON "RoastCurvePoint"("curveId", "timeSec");

-- CreateIndex
CREATE UNIQUE INDEX "FlavorTag_name_key" ON "FlavorTag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CuppingTemplate_name_key" ON "CuppingTemplate"("name");

-- CreateIndex
CREATE INDEX "CuppingSession_cuppedAt_idx" ON "CuppingSession"("cuppedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CuppingScore_sessionId_attributeKey_key" ON "CuppingScore"("sessionId", "attributeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_type_name_key" ON "Equipment"("type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BrewRecipe_rootId_version_key" ON "BrewRecipe"("rootId", "version");

-- CreateIndex
CREATE INDEX "BrewSession_brewedAt_idx" ON "BrewSession"("brewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrewPourStep_sessionId_stepNo_key" ON "BrewPourStep"("sessionId", "stepNo");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProject_code_key" ON "ResearchProject"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchExperiment_projectId_version_key" ON "ResearchExperiment"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_code_key" ON "InventoryLocation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_productVariantId_key" ON "InventoryItem"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_materialId_key" ON "InventoryItem"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_kind_coffeeId_key" ON "InventoryItem"("kind", "coffeeId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_lotCode_key" ON "InventoryLot"("lotCode");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_greenLotId_key" ON "InventoryLot"("greenLotId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_roastBatchId_key" ON "InventoryLot"("roastBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_packagingBatchId_key" ON "InventoryLot"("packagingBatchId");

-- CreateIndex
CREATE INDEX "InventoryLot_itemId_status_idx" ON "InventoryLot"("itemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_idempotencyKey_key" ON "InventoryTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_reversesId_key" ON "InventoryTransaction"("reversesId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_lotId_occurredAt_idx" ON "InventoryTransaction"("lotId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_itemId_occurredAt_idx" ON "InventoryTransaction"("itemId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_refType_refId_idx" ON "InventoryTransaction"("refType", "refId");

-- CreateIndex
CREATE INDEX "InventoryReservation_lotId_status_idx" ON "InventoryReservation"("lotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_orderNo_key" ON "ProductionOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingBatch_batchNo_key" ON "PackagingBatch"("batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingBatch_productionOrderId_key" ON "PackagingBatch"("productionOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSeries_code_key" ON "BrandSeries"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBundleComponent_bundleVariantId_componentVariantId_key" ON "ProductBundleComponent"("bundleVariantId", "componentVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantMaterial_variantId_materialId_key" ON "VariantMaterial"("variantId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderNo_key" ON "SalesOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_externalRef_key" ON "SalesOrder"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_idempotencyKey_key" ON "SalesOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SalesOrder_orderedAt_idx" ON "SalesOrder"("orderedAt");

-- CreateIndex
CREATE INDEX "SalesOrder_paymentStatus_fulfillmentStatus_idx" ON "SalesOrder"("paymentStatus", "fulfillmentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBatchAllocation_reservationId_key" ON "OrderBatchAllocation"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_idempotencyKey_key" ON "PaymentRecord"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_orderId_key" ON "Shipment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRecord_returnNo_key" ON "ReturnRecord"("returnNo");

-- CreateIndex
CREATE INDEX "CostEntry_occurredOn_idx" ON "CostEntry"("occurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "CostAllocationRule_name_key" ON "CostAllocationRule"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTraceability_publicCode_key" ON "ProductTraceability"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTraceability_packagingBatchId_key" ON "ProductTraceability"("packagingBatchId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coffee" ADD CONSTRAINT "Coffee_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GreenBeanPurchase" ADD CONSTRAINT "GreenBeanPurchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GreenBeanLot" ADD CONSTRAINT "GreenBeanLot_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "GreenBeanPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GreenBeanLot" ADD CONSTRAINT "GreenBeanLot_coffeeId_fkey" FOREIGN KEY ("coffeeId") REFERENCES "Coffee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GreenBeanLot" ADD CONSTRAINT "GreenBeanLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoastBatch" ADD CONSTRAINT "RoastBatch_greenLotId_fkey" FOREIGN KEY ("greenLotId") REFERENCES "GreenBeanLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoastBatch" ADD CONSTRAINT "RoastBatch_roasterId_fkey" FOREIGN KEY ("roasterId") REFERENCES "RoasterProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoastEvent" ADD CONSTRAINT "RoastEvent_roastBatchId_fkey" FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoastCurve" ADD CONSTRAINT "RoastCurve_roastBatchId_fkey" FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoastCurvePoint" ADD CONSTRAINT "RoastCurvePoint_curveId_fkey" FOREIGN KEY ("curveId") REFERENCES "RoastCurve"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuppingSession" ADD CONSTRAINT "CuppingSession_roastBatchId_fkey" FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuppingSession" ADD CONSTRAINT "CuppingSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CuppingTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuppingScore" ADD CONSTRAINT "CuppingScore_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CuppingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuppingSessionTag" ADD CONSTRAINT "CuppingSessionTag_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CuppingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuppingSessionTag" ADD CONSTRAINT "CuppingSessionTag_flavorTagId_fkey" FOREIGN KEY ("flavorTagId") REFERENCES "FlavorTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewRecipe" ADD CONSTRAINT "BrewRecipe_coffeeId_fkey" FOREIGN KEY ("coffeeId") REFERENCES "Coffee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewRecipe" ADD CONSTRAINT "BrewRecipe_grinderId_fkey" FOREIGN KEY ("grinderId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewRecipe" ADD CONSTRAINT "BrewRecipe_dripperId_fkey" FOREIGN KEY ("dripperId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewRecipe" ADD CONSTRAINT "BrewRecipe_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewSession" ADD CONSTRAINT "BrewSession_roastBatchId_fkey" FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewSession" ADD CONSTRAINT "BrewSession_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "BrewRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewSession" ADD CONSTRAINT "BrewSession_grinderId_fkey" FOREIGN KEY ("grinderId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewSession" ADD CONSTRAINT "BrewSession_dripperId_fkey" FOREIGN KEY ("dripperId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewSession" ADD CONSTRAINT "BrewSession_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewPourStep" ADD CONSTRAINT "BrewPourStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BrewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewSessionTag" ADD CONSTRAINT "BrewSessionTag_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BrewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewSessionTag" ADD CONSTRAINT "BrewSessionTag_flavorTagId_fkey" FOREIGN KEY ("flavorTagId") REFERENCES "FlavorTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchExperiment" ADD CONSTRAINT "ResearchExperiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchExperimentLink" ADD CONSTRAINT "ResearchExperimentLink_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ResearchExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchExperimentLink" ADD CONSTRAINT "ResearchExperimentLink_roastBatchId_fkey" FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchExperimentLink" ADD CONSTRAINT "ResearchExperimentLink_cuppingSessionId_fkey" FOREIGN KEY ("cuppingSessionId") REFERENCES "CuppingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchExperimentLink" ADD CONSTRAINT "ResearchExperimentLink_brewSessionId_fkey" FOREIGN KEY ("brewSessionId") REFERENCES "BrewSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_coffeeId_fkey" FOREIGN KEY ("coffeeId") REFERENCES "Coffee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_greenLotId_fkey" FOREIGN KEY ("greenLotId") REFERENCES "GreenBeanLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_roastBatchId_fkey" FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_packagingBatchId_fkey" FOREIGN KEY ("packagingBatchId") REFERENCES "PackagingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_returnSourceLotId_fkey" FOREIGN KEY ("returnSourceLotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "InventoryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_sourceLotId_fkey" FOREIGN KEY ("sourceLotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_targetVariantId_fkey" FOREIGN KEY ("targetVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionConsumption" ADD CONSTRAINT "ProductionConsumption_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionConsumption" ADD CONSTRAINT "ProductionConsumption_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingBatch" ADD CONSTRAINT "PackagingBatch_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSeries" ADD CONSTRAINT "BrandSeries_recommendedRecipeId_fkey" FOREIGN KEY ("recommendedRecipeId") REFERENCES "BrewRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandSeriesId_fkey" FOREIGN KEY ("brandSeriesId") REFERENCES "BrandSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_coffeeId_fkey" FOREIGN KEY ("coffeeId") REFERENCES "Coffee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBundleComponent" ADD CONSTRAINT "ProductBundleComponent_bundleVariantId_fkey" FOREIGN KEY ("bundleVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBundleComponent" ADD CONSTRAINT "ProductBundleComponent_componentVariantId_fkey" FOREIGN KEY ("componentVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMaterial" ADD CONSTRAINT "VariantMaterial_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMaterial" ADD CONSTRAINT "VariantMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBatchAllocation" ADD CONSTRAINT "OrderBatchAllocation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBatchAllocation" ADD CONSTRAINT "OrderBatchAllocation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBatchAllocation" ADD CONSTRAINT "OrderBatchAllocation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBatchAllocation" ADD CONSTRAINT "OrderBatchAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "OrderBatchAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_roastBatchId_fkey" FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_allocationRuleId_fkey" FOREIGN KEY ("allocationRuleId") REFERENCES "CostAllocationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTraceability" ADD CONSTRAINT "ProductTraceability_packagingBatchId_fkey" FOREIGN KEY ("packagingBatchId") REFERENCES "PackagingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
