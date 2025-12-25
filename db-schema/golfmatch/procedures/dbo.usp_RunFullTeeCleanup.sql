

CREATE PROCEDURE dbo.usp_RunFullTeeCleanup
(
    @CourseID INT,
    @Confirm BIT = 0    -- 0 = PREVIEW ONLY, 1 = EXECUTE CLEANUP
)
AS
BEGIN
    SET NOCOUNT ON;

    PRINT '============================================================';
    PRINT ' RUN FULL TEE CLEANUP PROCESS';
    PRINT ' CourseID: ' + CAST(@CourseID AS VARCHAR(10));
    PRINT ' Confirm Flag: ' + CAST(@Confirm AS VARCHAR(10));
    PRINT '============================================================';


    /* ============================================================
       SAFETY CHECKS
       ============================================================ */

    -- Validate CourseID exists
    IF NOT EXISTS (SELECT 1 FROM Courses WHERE CourseID = @CourseID)
    BEGIN
        RAISERROR('Invalid CourseID. No cleanup performed.', 16, 1);
        RETURN;
    END;

    -- Validate CourseDefaults exist for both genders
    DECLARE @DefaultCount INT =
    (
        SELECT COUNT(*) 
        FROM CourseDefaults 
        WHERE CourseID = @CourseID
    );

    IF @DefaultCount <> 2
    BEGIN
        RAISERROR('CourseDefaults missing for one or more genders. Cleanup aborted.', 16, 1);
        RETURN;
    END;

    PRINT 'Safety checks passed.';
    PRINT '';


    /* ============================================================
       PHASE 1 — PRE-VERIFICATION (ALWAYS RUN)
       ============================================================ */

    PRINT '--- PRE-VERIFICATION: Default logical tees ---';
    SELECT 
        'DEFAULT_LOGICAL_TEES' AS Category,
        CD.CourseID,
        CD.Gender,
        CD.DefaultTeeID AS TeeID,
        T.TeeName
    FROM CourseDefaults CD
    JOIN Tees T ON T.TeeID = CD.DefaultTeeID
    WHERE CD.CourseID = @CourseID;


    PRINT '--- PRE-VERIFICATION: Logical tees to delete ---';
    SELECT
        'LOGICAL_TEES_TO_DELETE' AS Category,
        TR.TeeID,
        TR.Gender,
        T.CourseID,
        T.TeeName
    FROM TeeRatings TR
    JOIN Tees T ON T.TeeID = TR.TeeID
    WHERE T.CourseID = @CourseID
      AND NOT EXISTS (
            SELECT 1
            FROM CourseDefaults CD
            WHERE CD.CourseID = @CourseID
              AND CD.Gender   = TR.Gender
              AND CD.DefaultTeeID = TR.TeeID
      );

    
    /* ============================================================
       ASK FOR CONFIRMATION — STOP HERE IF @Confirm = 0
       ============================================================ */

    IF @Confirm = 0
    BEGIN
        PRINT '';
        PRINT '============================================================';
        PRINT ' PRE-VERIFY MODE — NO DATA HAS BEEN MODIFIED.';
        PRINT ' Re-run with @Confirm = 1 to perform cleanup.';
        PRINT '============================================================';
        RETURN;
    END;


    /* ============================================================
       PHASE 2 — CLEANUP (ONLY RUN WHEN @Confirm = 1)
       ============================================================ */

    PRINT '';
    PRINT '--- CLEANUP STARTED: Deleting HoleOverrides, TeeRatings, and Tees ---';


    ------------------------------------------------------------
    -- DELETE HOLEOVERRIDES
    ------------------------------------------------------------
    DELETE HO
    FROM HoleOverrides HO
    JOIN Tees T ON T.TeeID = HO.TeeID
    WHERE T.CourseID = @CourseID
      AND NOT EXISTS (
            SELECT 1
            FROM CourseDefaults CD
            WHERE CD.CourseID = @CourseID
              AND CD.Gender   = HO.Gender
              AND CD.DefaultTeeID = HO.TeeID
      );

    DECLARE @HO_Count INT;
    SELECT @HO_Count = COUNT(*)
    FROM HoleOverrides HO
    JOIN Tees T ON T.TeeID = HO.TeeID
    WHERE T.CourseID = @CourseID;

    PRINT 'HoleOverrides cleaned. Remaining rows: ' + CAST(@HO_Count AS VARCHAR(10));


    ------------------------------------------------------------
    -- DELETE TEERATINGS
    ------------------------------------------------------------
    DELETE TR
    FROM TeeRatings TR
    JOIN Tees T ON T.TeeID = TR.TeeID
    WHERE T.CourseID = @CourseID
      AND NOT EXISTS (
            SELECT 1
            FROM CourseDefaults CD
            WHERE CD.CourseID = @CourseID
              AND CD.Gender   = TR.Gender
              AND CD.DefaultTeeID = TR.TeeID
      );

    DECLARE @TR_Count INT;
    SELECT @TR_Count = COUNT(*)
    FROM TeeRatings TR
    JOIN Tees T ON T.TeeID = TR.TeeID
    WHERE T.CourseID = @CourseID;

    PRINT 'TeeRatings cleaned. Remaining rows: ' + CAST(@TR_Count AS VARCHAR(10));


    ------------------------------------------------------------
    -- DELETE TEES
    ------------------------------------------------------------
    DELETE T
    FROM Tees T
    WHERE T.CourseID = @CourseID
      AND NOT EXISTS (
            SELECT 1
            FROM CourseDefaults CD
            WHERE CD.DefaultTeeID = T.TeeID
              AND CD.CourseID     = @CourseID
      );

    DECLARE @Tee_Count INT;
    SELECT @Tee_Count = COUNT(*)
    FROM Tees
    WHERE CourseID = @CourseID;

    PRINT 'Tees cleaned. Remaining rows: ' + CAST(@Tee_Count AS VARCHAR(10));



    /* ============================================================
       PHASE 3 — VALIDATION
       ============================================================ */

    PRINT '';
    PRINT '--- VALIDATION: Remaining Default Tees ---';
    SELECT 
        'REMAINING_DEFAULT_LOGICAL_TEES' AS Category,
        CD.CourseID,
        CD.Gender,
        CD.DefaultTeeID AS TeeID,
        T.TeeName
    FROM CourseDefaults CD
    JOIN Tees T ON T.TeeID = CD.DefaultTeeID
    WHERE CD.CourseID = @CourseID;


    PRINT '--- VALIDATION: Remaining Logical Tees ---';
    SELECT
        'REMAINING_LOGICAL_TEES' AS Category,
        TR.TeeID,
        TR.Gender,
        T.CourseID,
        T.TeeName
    FROM TeeRatings TR
    JOIN Tees T ON T.TeeID = TR.TeeID
    WHERE T.CourseID = @CourseID;


    PRINT '--- VALIDATION: TeeRatings Detail ---';
    SELECT
        'REMAINING_TEERATINGS' AS Category,
        TR.TeeID,
        TR.Gender,
        TR.CourseRating,
        TR.Slope,
        T.CourseID,
        T.TeeName
    FROM TeeRatings TR
    JOIN Tees T ON T.TeeID = TR.TeeID
    WHERE T.CourseID = @CourseID;


    PRINT '--- VALIDATION: Orphaned TeeRatings (should be ZERO) ---';
    SELECT
        'ORPHANED_TEERATINGS' AS Category,
        TR.*
    FROM TeeRatings TR
    JOIN Tees T ON T.TeeID = TR.TeeID
    WHERE T.CourseID = @CourseID
      AND NOT EXISTS (
            SELECT 1
            FROM CourseDefaults CD
            WHERE CD.CourseID = @CourseID
              AND CD.Gender   = TR.Gender
              AND CD.DefaultTeeID = TR.TeeID
      );


    PRINT '--- VALIDATION: Orphaned HoleOverrides (should be ZERO) ---';
    SELECT
        'ORPHANED_HOLEOVERRIDES' AS Category,
        HO.*
    FROM HoleOverrides HO
    JOIN Tees T ON T.TeeID = HO.TeeID
    WHERE T.CourseID = @CourseID
      AND NOT EXISTS (
            SELECT 1
            FROM CourseDefaults CD
            WHERE CD.CourseID = @CourseID
              AND CD.Gender   = HO.Gender
              AND CD.DefaultTeeID = HO.TeeID
      );


    PRINT '--- VALIDATION: Remaining TeeIDs ---';
    SELECT
        'REMAINING_TEEIDS' AS Category,
        T.*
    FROM Tees T
    WHERE T.CourseID = @CourseID;


    PRINT '--- VALIDATION: TeeIDs That Should NOT Exist (ZERO expected) ---';
    SELECT
        'TEEIDS_NOT_USED_BY_DEFAULTS' AS Category,
        T.*
    FROM Tees T
    WHERE T.CourseID = @CourseID
      AND NOT EXISTS (
            SELECT 1
            FROM CourseDefaults CD
            WHERE CD.DefaultTeeID = T.TeeID
              AND CD.CourseID     = @CourseID
      );


    PRINT '';
    PRINT '============================================================';
    PRINT ' FULL TEE CLEANUP PROCESS COMPLETE';
    PRINT '============================================================';

END;
