import { assertConfig } from '../src/config.js';
import { closePool, query } from '../src/db.js';

const checks = [];

function expectValue(name, actual, expected) {
  const passed = actual === expected;
  checks.push({ name, passed, actual, expected });
}

function expectTruthy(name, actual) {
  const passed = Boolean(actual);
  checks.push({ name, passed, actual, expected: true });
}

try {
  assertConfig();

  const runtimeResult = await query(`
    SET NOCOUNT ON;
    SELECT
      SUSER_SNAME() AS LoginName,
      USER_NAME() AS DatabaseUser,
      DB_NAME() AS DatabaseName,
      OBJECT_ID(N'dbo.Hardware', N'U') AS HardwareTableId,
      OBJECT_ID(N'dbo.Personnel', N'U') AS PersonnelTableId,
      OBJECT_ID(N'dbo.OperationQueue', N'U') AS OperationQueueTableId,
      OBJECT_ID(N'dbo.ReserveAgentRequestNonce', N'P') AS ReserveNonceProcedureId,
      OBJECT_ID(N'dbo.PruneZimmetTransientData', N'P') AS PruneProcedureId,
      OBJECT_ID(N'dbo.vw_SystemLogChainVerification', N'V') AS LogVerificationViewId,
      COL_LENGTH(N'dbo.Sessions', N'TokenHash') AS SessionTokenHashColumn,
      COL_LENGTH(N'dbo.OperationQueue', N'LeaseToken') AS QueueLeaseTokenColumn,
      COL_LENGTH(N'dbo.OperationQueue', N'LeaseExpiresAt') AS QueueLeaseExpiryColumn,
      COL_LENGTH(N'dbo.SystemLogs', N'ChainHash') AS LogChainHashColumn,
      COL_LENGTH(N'dbo.Personnel', N'NationalIdHash') AS PersonnelNationalIdHashColumn,
      COALESCE(IS_ROLEMEMBER(N'db_owner'), 0) AS IsDbOwner,
      COALESCE(IS_ROLEMEMBER(N'db_datareader'), 0) AS IsDataReader,
      COALESCE(IS_ROLEMEMBER(N'db_datawriter'), 0) AS IsDataWriter,
      HAS_PERMS_BY_NAME(N'dbo.Hardware', N'OBJECT', N'SELECT') AS HardwareSelect,
      HAS_PERMS_BY_NAME(N'dbo.Hardware', N'OBJECT', N'UPDATE') AS HardwareUpdate,
      HAS_PERMS_BY_NAME(N'dbo.Hardware', N'OBJECT', N'DELETE') AS HardwareDelete,
      HAS_PERMS_BY_NAME(N'dbo.SystemLogs', N'OBJECT', N'INSERT') AS SystemLogInsert,
      HAS_PERMS_BY_NAME(N'dbo.SystemLogs', N'OBJECT', N'UPDATE') AS SystemLogUpdate,
      HAS_PERMS_BY_NAME(N'dbo.SystemLogs', N'OBJECT', N'DELETE') AS SystemLogDelete,
      HAS_PERMS_BY_NAME(N'dbo.AgentRequestNonces', N'OBJECT', N'SELECT') AS NonceTableSelect,
      HAS_PERMS_BY_NAME(N'dbo.ReserveAgentRequestNonce', N'OBJECT', N'EXECUTE') AS ReserveNonceExecute,
      HAS_PERMS_BY_NAME(N'dbo.PruneZimmetTransientData', N'OBJECT', N'EXECUTE') AS PruneExecute;
  `);
  const runtime = runtimeResult.recordset[0] || {};

  expectValue('Veritabanı adı', runtime.DatabaseName, 'IstekZimmet');
  expectTruthy('Hardware tablosu', runtime.HardwareTableId);
  expectTruthy('Personnel tablosu', runtime.PersonnelTableId);
  expectTruthy('OperationQueue tablosu', runtime.OperationQueueTableId);
  expectTruthy('Nonce rezervasyon prosedürü', runtime.ReserveNonceProcedureId);
  expectTruthy('Kuyruk saklama prosedürü', runtime.PruneProcedureId);
  expectTruthy('Log doğrulama görünümü', runtime.LogVerificationViewId);
  expectTruthy('Session TokenHash kolonu', runtime.SessionTokenHashColumn);
  expectTruthy('Queue LeaseToken kolonu', runtime.QueueLeaseTokenColumn);
  expectTruthy('Queue LeaseExpiresAt kolonu', runtime.QueueLeaseExpiryColumn);
  expectTruthy('SystemLogs ChainHash kolonu', runtime.LogChainHashColumn);
  expectTruthy('Personnel NationalIdHash kolonu', runtime.PersonnelNationalIdHashColumn);
  expectValue('db_owner rolü kapalı', runtime.IsDbOwner, 0);
  expectValue('db_datareader rolü kapalı', runtime.IsDataReader, 0);
  expectValue('db_datawriter rolü kapalı', runtime.IsDataWriter, 0);
  expectValue('Hardware SELECT izni', runtime.HardwareSelect, 1);
  expectValue('Hardware UPDATE izni', runtime.HardwareUpdate, 1);
  expectValue('Hardware DELETE reddi', runtime.HardwareDelete, 0);
  expectValue('SystemLogs INSERT izni', runtime.SystemLogInsert, 1);
  expectValue('SystemLogs UPDATE reddi', runtime.SystemLogUpdate, 0);
  expectValue('SystemLogs DELETE reddi', runtime.SystemLogDelete, 0);
  expectValue('Nonce tablosu doğrudan SELECT reddi', runtime.NonceTableSelect, 0);
  expectValue('Nonce prosedürü EXECUTE izni', runtime.ReserveNonceExecute, 1);
  expectValue('Kuyruk temizleme EXECUTE izni', runtime.PruneExecute, 1);

  const chainResult = await query(`
    SELECT
      COUNT_BIG(*) AS TotalLogs,
      SUM(CASE WHEN IsValid = 0 THEN 1 ELSE 0 END) AS InvalidLogs
    FROM dbo.vw_SystemLogChainVerification;
  `);
  const chain = chainResult.recordset[0] || {};
  expectValue('Log zinciri bozuk kayıt', Number(chain.InvalidLogs || 0), 0);

  const failures = checks.filter((item) => !item.passed);
  console.log(JSON.stringify({
    success: failures.length === 0,
    login: runtime.LoginName,
    databaseUser: runtime.DatabaseUser,
    database: runtime.DatabaseName,
    totalLogs: String(chain.TotalLogs || 0),
    checks,
    failures
  }, null, 2));

  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: String(error?.message || error)
  }, null, 2));
  process.exitCode = 1;
} finally {
  await closePool();
}
