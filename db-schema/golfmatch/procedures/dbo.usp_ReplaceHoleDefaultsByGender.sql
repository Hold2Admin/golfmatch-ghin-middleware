CREATE   PROCEDURE dbo.usp_ReplaceHoleDefaultsByGender
(
    @CourseID       INT,
    @Gender         CHAR(1),         -- 'M' or 'W'
    @NumHoles       INT,             -- 9 or 18
    @ParString      NVARCHAR(50),    -- e.g. '443453544' or '443453544534454344'
    @HandicapString NVARCHAR(200)    -- e.g. '6,10,2,14,...'
)
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        ----------------------------------------------------------
        -- 1. Validation
        ----------------------------------------------------------
        IF @Gender NOT IN ('M','W')
            THROW 50501, 'Gender must be ''M'' or ''W''.', 1;

        IF @NumHoles NOT IN (9,18)
            THROW 50502, 'NumHoles must be 9 or 18.', 1;

        IF LEN(ISNULL(@ParString,'')) NOT IN (9,18)
            THROW 50503, 'ParString must contain exactly 9 or 18 digits (one per hole).', 1;

        IF LEN(ISNULL(@HandicapString,'')) = 0
            THROW 50504, 'HandicapString is required.', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.Courses WHERE CourseID = @CourseID)
            THROW 50505, 'CourseID not found.', 1;

        ----------------------------------------------------------
        -- 2. Resolve DefaultTeeID for this gender (fallback to Men)
        ----------------------------------------------------------
        DECLARE @DefaultTeeID INT;

        SELECT @DefaultTeeID = DefaultTeeID
        FROM dbo.CourseDefaults
        WHERE CourseID = @CourseID
          AND Gender   = @Gender;

        IF @DefaultTeeID IS NULL
        BEGIN
            -- fallback to Men’s default (consistent with GHIN rules)
            SELECT @DefaultTeeID = DefaultTeeID
            FROM dbo.CourseDefaults
            WHERE CourseID = @CourseID
              AND Gender   = 'M';

            IF @DefaultTeeID IS NULL
                THROW 50506, 'No default tee exists for this course.', 1;
        END;

        ----------------------------------------------------------
        -- 3. Parse ParString and HandicapString
        ----------------------------------------------------------
        DECLARE @HoleList TABLE
        (
            HoleNumber INT,
            Par        INT,
            Handicap   INT
        );

        DECLARE @i INT = 1;
        DECLARE @Par INT;
        DECLARE @Handicap INT;
        DECLARE @pos INT;
        DECLARE @Chunk NVARCHAR(10);

        DECLARE @HcpWork NVARCHAR(200) = @HandicapString;

        WHILE @i <= @NumHoles
        BEGIN
            -- extract Par (1 digit)
            SET @Par = TRY_CONVERT(INT, SUBSTRING(@ParString, @i, 1));
            IF @Par IS NULL
                THROW 50507, 'ParString contains non-numeric characters.', 1;

            -- extract Handicap (1–2 digits)
            SET @pos = CHARINDEX(',', @HcpWork + ',');
            IF @pos = 0
                THROW 50508, 'HandicapString must be comma-separated (e.g. 6,10,2,...).', 1;

            SET @Chunk = LEFT(@HcpWork, @pos - 1);
            SET @Handicap = TRY_CONVERT(INT, @Chunk);
            IF @Handicap IS NULL
                THROW 50509, 'HandicapString contains non-numeric values.', 1;

            SET @HcpWork = LTRIM(STUFF(@HcpWork, 1, @pos, ''));

            INSERT INTO @HoleList (HoleNumber, Par, Handicap)
            VALUES (@i, @Par, @Handicap);

            SET @i += 1;
        END;

        ----------------------------------------------------------
        -- 4. Delete existing defaults for this default tee + gender
        ----------------------------------------------------------
        DELETE FROM dbo.HoleDefaults
        WHERE DefaultTeeID = @DefaultTeeID
          AND Gender       = @Gender;

        ----------------------------------------------------------
        -- 5. Insert new defaults
        ----------------------------------------------------------
        INSERT INTO dbo.HoleDefaults (DefaultTeeID, Gender, HoleNumber, Par, Handicap)
        SELECT @DefaultTeeID, @Gender, HoleNumber, Par, Handicap
        FROM @HoleList;

        ----------------------------------------------------------
        -- 6. Commit
        ----------------------------------------------------------
        RETURN;
    END TRY
    BEGIN CATCH
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH;
END;
