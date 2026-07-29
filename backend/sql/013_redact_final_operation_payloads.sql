USE IstekZimmet;
GO

/*
  Tamamlanmış veya yeniden deneme hakkı bitmiş PDF işlerinde ham imza,
  OTP, e-posta gövdesi ve istemci verisi tutulmaz. Bekleyen, işlenen ve
  yeniden denenebilir işler PDF üretimi için tam payload'ı korur.
*/

IF OBJECT_ID(N'dbo.OperationQueue', N'U') IS NOT NULL
BEGIN
  UPDATE q
  SET PayloadJson = (
    SELECT
      1 AS payloadVersion,
      CAST(1 AS bit) AS payloadRedacted,
      CONVERT(NVARCHAR(33), SYSUTCDATETIME(), 127) + N'Z' AS redactedAt,
      q.ActionType AS actionType,
      JSON_VALUE(q.PayloadJson, N'$.documentType') AS documentType,
      JSON_VALUE(q.PayloadJson, N'$.pdfName') AS pdfName,
      JSON_VALUE(q.PayloadJson, N'$.campus') AS campus,
      JSON_VALUE(q.PayloadJson, N'$.senderCampus') AS senderCampus,
      JSON_VALUE(q.PayloadJson, N'$.receiverCampus') AS receiverCampus,
      JSON_VALUE(q.PayloadJson, N'$.transferDirection') AS transferDirection,
      JSON_QUERY((
        SELECT
          JSON_VALUE(q.PayloadJson, N'$.person.id') AS id,
          JSON_VALUE(q.PayloadJson, N'$.person.name') AS name,
          JSON_VALUE(q.PayloadJson, N'$.person.campus') AS campus,
          JSON_VALUE(q.PayloadJson, N'$.person.department') AS department
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
      )) AS person,
      JSON_QUERY(q.PayloadJson, N'$.hardware') AS hardware,
      (SELECT COUNT_BIG(1) FROM OPENJSON(q.PayloadJson, N'$.hardware')) AS hardwareCount
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  )
  FROM dbo.OperationQueue q
  WHERE q.ActionType IN (
      N'GENERATE_ZIMMET_PDF',
      N'GENERATE_RETURN_PDF',
      N'GENERATE_TRANSFER_PDF'
    )
    AND ISJSON(q.PayloadJson) = 1
    AND ISNULL(JSON_VALUE(q.PayloadJson, N'$.payloadRedacted'), N'false') <> N'true'
    AND (
      q.Status = N'TAMAMLANDI'
      OR (q.Status = N'HATA' AND q.AttemptCount >= 5)
    );
END;
GO
