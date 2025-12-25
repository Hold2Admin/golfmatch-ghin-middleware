CREATE   PROCEDURE dbo.usp_UpsertTeeHoleOverridesFromString
    @CourseID INT,
    @TeeID    INT,
    @Gender   CHAR(1),        -- 'M' or 'W'
    @NumHoles INT,            -- 9 or 18
    @HoleData NVARCHAR(MAX)   -- 'Par,Handicap;Par,Handicap;...'
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        ------------------------------------------------------
        -- 1. Basic validation
        ------------------------------------------------------
        IF @Gender NOT IN ('M','W')
            THROW 50301, 'Gender must be ''M'' or ''W''.', 1;

        IF @NumHoles NOT IN (9,18)
            THROW 50302, 'NumHoles must be 9 or 18.', 1;

        IF LEN(ISNULL(@HoleData, '')) = 0
           OR CHARINDEX(',', @HoleData) = 0
           OR CHARINDEX(';', @HoleData) = 0
            THROW 50303, 'HoleData must be formatted as ''Par,Handicap;Par,Handicap;...''.', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.Courses WHERE CourseID = @CourseID)
            THROW 50304, 'CourseID not found.', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.Tees WHERE TeeID = @TeeID AND CourseID = @CourseID)
            THROW 50305, 'TeeID not found for this CourseID.', 1;

        BEGIN TRAN;

        ------------------------------------------------------
        -- 2. Parse HoleData into @HoleList
        ------------------------------------------------------
        DECLARE @HoleList TABLE
        (
            HoleNumber INT IDENTITY(1,1),
            Par        INT,
            Handicap   INT
        );

        DECLARE @Pos   INT = 1;
        DECLARE @Delim INT;
        DECLARE @Chunk NVARCHAR(50);

        WHILE @Pos > 0
        BEGIN
            SET @Delim = CHARINDEX(';', @HoleData, @Pos);
            SET @Chunk = CASE WHEN @Delim > 0
                              THEN SUBSTRING(@HoleData, @Pos, @Delim - @Pos)
                              ELSE SUBSTRING(@HoleData, @Pos, LEN(@HoleData) - @Pos + 1)
                         END;

            DECLARE @Par INT = TRY_CONVERT(INT, PARSENAME(REPLACE(@Chunk, ',', '.'), 2));
            DECLARE @Hcp INT = TRY_CONVERT(INT, PARSENAME(REPLACE(@Chunk, ',', '.'), 1));

            IF @Par IS NULL OR @Hcp IS NULL
                THROW 50306, 'Invalid Par or Handicap detected in HoleData.', 1;

            INSERT INTO @HoleList (Par, Handicap)
            VALUES (@Par, @Hcp);

            IF @Delim = 0 BREAK;
            SET @Pos = @Delim + 1;
        END;

        IF (SELECT COUNT(*) FROM @HoleList) <> @NumHoles
            THROW 50307, 'Number of hole pairs does not match @NumHoles.', 1;

        ------------------------------------------------------
        -- 3. Resolve default tee + defaults gender
        ------------------------------------------------------
        DECLARE @DefaultTeeID   INT;
        DECLARE @DefaultsGender CHAR(1);

        SELECT @DefaultTeeID = DefaultTeeID
        FROM dbo.CourseDefaults
        WHERE CourseID = @CourseID
          AND Gender   = @Gender;

        IF @DefaultTeeID IS NOT NULL
            SET @DefaultsGender = @Gender;
        ELSE
        BEGIN
            SELECT @DefaultTeeID = DefaultTeeID
            FROM dbo.CourseDefaults
            WHERE CourseID = @CourseID
              AND Gender   = 'M';

            SET @DefaultsGender = 'M';
        END;

        IF @DefaultTeeID IS NULL
            THROW 50308, 'No CourseDefaults found for this CourseID.', 1;

        -- If no HoleDefaults for chosen defaults gender but Men exist, fall back to Men
        IF NOT EXISTS (
            SELECT 1
            FROM dbo.HoleDefaults
            WHERE DefaultTeeID = @DefaultTeeID
              AND Gender       = @DefaultsGender
        )
        AND EXISTS (
            SELECT 1
            FROM dbo.HoleDefaults
            WHERE DefaultTeeID = @DefaultTeeID
              AND Gender       = 'M'
        )
        BEGIN
            SET @DefaultsGender = 'M';
        END;

        ------------------------------------------------------
        -- 4. Load defaults into @Defaults table
        ------------------------------------------------------
        DECLARE @Defaults TABLE
        (
            HoleNumber INT PRIMARY KEY,
            Par        INT NULL,
            Handicap   INT NULL
        );

        INSERT INTO @Defaults (HoleNumber, Par, Handicap)
        SELECT HoleNumber, Par, Handicap
        FROM dbo.HoleDefaults
        WHERE DefaultTeeID = @DefaultTeeID
          AND Gender       = @DefaultsGender;

        ------------------------------------------------------
        -- 5. Option C: delete all overrides for this tee+gender,
        --    then reinsert only the differences vs defaults
        ------------------------------------------------------
        DELETE FROM dbo.HoleOverrides
        WHERE TeeID  = @TeeID
          AND Gender = @Gender;

        INSERT INTO dbo.HoleOverrides (TeeID, Gender, HoleNumber, Par, Handicap)
        SELECT
            @TeeID      AS TeeID,
            @Gender     AS Gender,
            hl.HoleNumber,
            hl.Par,
            hl.Handicap
        FROM @HoleList hl
        LEFT JOIN @Defaults d
            ON d.HoleNumber = hl.HoleNumber
        WHERE
            d.HoleNumber IS NULL                -- no default
            OR hl.Par      <> ISNULL(d.Par, hl.Par)
            OR hl.Handicap <> ISNULL(d.Handicap, hl.Handicap);

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH;
END;
