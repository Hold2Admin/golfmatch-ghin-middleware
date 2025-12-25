CREATE   PROCEDURE dbo.usp_ApplyHoleDefaultsToAllTeesByGender
(
    @CourseID INT,
    @Gender   CHAR(1)   -- 'M' or 'W'
)
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        ----------------------------------------------------------
        -- 1. Validate input
        ----------------------------------------------------------
        IF @Gender NOT IN ('M','W')
            THROW 50601, 'Gender must be ''M'' or ''W''.', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.Courses WHERE CourseID = @CourseID)
            THROW 50602, 'CourseID not found.', 1;

        ----------------------------------------------------------
        -- 2. Resolve default tee for this gender (fallback to Men)
        ----------------------------------------------------------
        DECLARE @DefaultTeeID INT;

        SELECT @DefaultTeeID = DefaultTeeID
        FROM dbo.CourseDefaults
        WHERE CourseID = @CourseID
          AND Gender   = @Gender;

        IF @DefaultTeeID IS NULL
        BEGIN
            SELECT @DefaultTeeID = DefaultTeeID
            FROM dbo.CourseDefaults
            WHERE CourseID = @CourseID
              AND Gender   = 'M';

            IF @DefaultTeeID IS NULL
                THROW 50603, 'No default tee available for this course.', 1;
        END;

        ----------------------------------------------------------
        -- 3. Load the default hole data for this gender
        ----------------------------------------------------------
        DECLARE @Defaults TABLE
        (
            HoleNumber INT PRIMARY KEY,
            Par        INT,
            Handicap   INT
        );

        INSERT INTO @Defaults (HoleNumber, Par, Handicap)
        SELECT HoleNumber, Par, Handicap
        FROM dbo.HoleDefaults
        WHERE DefaultTeeID = @DefaultTeeID
          AND Gender       = @Gender;

        IF NOT EXISTS (SELECT 1 FROM @Defaults)
            THROW 50604, 'No hole defaults exist for this CourseID + Gender.', 1;

        ----------------------------------------------------------
        -- 4. Identify all tees of this gender
        ----------------------------------------------------------
        DECLARE @TeeList TABLE (TeeID INT PRIMARY KEY);

        INSERT INTO @TeeList (TeeID)
        SELECT t.TeeID
        FROM dbo.Tees t
        JOIN dbo.TeeRatings r
          ON r.TeeID = t.TeeID
         AND r.Gender = @Gender
        WHERE t.CourseID = @CourseID;

        ----------------------------------------------------------
        -- 5. Loop through each tee of this gender
        ----------------------------------------------------------
        DECLARE @TeeID INT;

        DECLARE c CURSOR LOCAL FAST_FORWARD FOR
            SELECT TeeID FROM @TeeList;

        OPEN c;
        FETCH NEXT FROM c INTO @TeeID;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            ------------------------------------------------------
            -- 6. Delete existing overrides for this tee/gender
            ------------------------------------------------------
            DELETE FROM dbo.HoleOverrides
            WHERE TeeID  = @TeeID
              AND Gender = @Gender;

            ------------------------------------------------------
            -- 7. Insert overrides only where tee's hole data differs
            --    (Option C smart inheritance)
            ------------------------------------------------------
            INSERT INTO dbo.HoleOverrides (TeeID, Gender, HoleNumber, Par, Handicap)
            SELECT
                @TeeID         AS TeeID,
                @Gender        AS Gender,
                d.HoleNumber,
                d.Par,
                d.Handicap
            FROM @Defaults d
            LEFT JOIN dbo.HoleOverrides o
              ON o.TeeID      = @TeeID
             AND o.Gender     = @Gender
             AND o.HoleNumber = d.HoleNumber
            WHERE o.HoleNumber IS NULL
              AND (
                     d.Par      IS NOT NULL
                  OR d.Handicap IS NOT NULL
              );

            ------------------------------------------------------
            FETCH NEXT FROM c INTO @TeeID;
        END;

        CLOSE c;
        DEALLOCATE c;

    END TRY
    BEGIN CATCH
        IF CURSOR_STATUS('local','c') >= 0
        BEGIN
            CLOSE c;
            DEALLOCATE c;
        END;

        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH;
END;
