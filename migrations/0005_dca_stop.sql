ALTER TABLE dca_plans ADD COLUMN stopped_on TEXT;
ALTER TABLE dca_plans ADD COLUMN stop_reason TEXT NOT NULL DEFAULT '';
UPDATE dca_plans SET status = '已停止' WHERE status = '已结束';
