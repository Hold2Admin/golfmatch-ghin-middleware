
CREATE PROCEDURE [dbo].[usp_AddTeeForCourseWithRatings]
(
      @CourseID          INT
    , @TeeName           NVARCHAR(100)
    , @MenCourseRating   DECIMAL(4,1) = NULL
    , @MenSlope          INT          = NULL
    , @WomenCourseRating DECIMAL(4,1) = NULL
    , @WomenSlope        INT          = NULL
)
AS
BEGIN
    SET NOCOUNT ON;

    IF @CourseID IS NULL
        THROW 51000, 'CourseID is required.', 1;

    IF (@MenCourseRating IS NULL OR @MenSlope IS NULL)
       AND (@WomenCourseRating IS NULL OR @WomenSlope IS NULL)
        THROW 51001, 'At least one complete rating (Men or Women) must be provided.', 1;

    DECLARE @TeeID INT;

    BEGIN TRY
        BEGIN TRAN;

        -----------------------------------------------------------
        -- 1. Ensure single TEES row exists for this base name
        -----------------------------------------------------------
        DECLARE @BaseTeeName NVARCHAR(100) = dbo.ufn_GetBaseTeeName(@TeeName);

        SELECT @TeeID = TeeID
        FROM dbo.Tees
        WHERE CourseID = @CourseID
          AND BaseTeeName = @BaseTeeName;

        IF @TeeID IS NULL
        BEGIN
            INSERT INTO dbo.Tees (CourseID, TeeName, BaseTeeName)
            VALUES (@CourseID, @BaseTeeName, @BaseTeeName);

            SET @TeeID = SCOPE_IDENTITY();
        END

        -----------------------------------------------------------
        -- 2. Insert OR update TeeRatings for Men
        -----------------------------------------------------------
        IF @MenCourseRating IS NOT NULL AND @MenSlope IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM dbo.TeeRatings WHERE TeeID=@TeeID AND Gender='M')
            BEGIN
                UPDATE dbo.TeeRatings
                SET CourseRating = @MenCourseRating,
                    Slope        = @MenSlope
                WHERE TeeID=@TeeID AND Gender='M';
            END
            ELSE
            BEGIN
                INSERT INTO dbo.TeeRatings (TeeID, Gender, CourseRating, Slope)
                VALUES (@TeeID, 'M', @MenCourseRating, @MenSlope);
            END
        END

        -----------------------------------------------------------
        -- 3. Insert OR update TeeRatings for Women
        -----------------------------------------------------------
        IF @WomenCourseRating IS NOT NULL AND @WomenSlope IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM dbo.TeeRatings WHERE TeeID=@TeeID AND Gender='W')
            BEGIN
                UPDATE dbo.TeeRatings
                SET CourseRating = @WomenCourseRating,
                    Slope        = @WomenSlope
                WHERE TeeID=@TeeID AND Gender='W';
            END
            ELSE
            BEGIN
                INSERT INTO dbo.TeeRatings (TeeID, Gender, CourseRating, Slope)
                VALUES (@TeeID, 'W', @WomenCourseRating, @WomenSlope);
            END
        END

        -----------------------------------------------------------
        -- 4. Recompute CourseDefaults
        -----------------------------------------------------------
        DECLARE @DefaultMenTeeID INT = NULL;
        DECLARE @DefaultWomenTeeID INT = NULL;

        SELECT TOP (1) @DefaultMenTeeID = t.TeeID
        FROM dbo.TeeRatings r
        JOIN dbo.Tees t ON t.TeeID = r.TeeID
        WHERE t.CourseID = @CourseID
          AND r.Gender='M'
        ORDER BY r.CourseRating DESC;

        SELECT TOP (1) @DefaultWomenTeeID = t.TeeID
        FROM dbo.TeeRatings r
        JOIN dbo.Tees t ON t.TeeID = r.TeeID
        WHERE t.CourseID = @CourseID
          AND r.Gender='W'
        ORDER BY r.CourseRating ASC;

        DELETE FROM dbo.CourseDefaults WHERE CourseID=@CourseID;

        IF @DefaultMenTeeID IS NOT NULL
            INSERT INTO dbo.CourseDefaults (CourseID, Gender, DefaultTeeID)
            VALUES (@CourseID, 'M', @DefaultMenTeeID);

        IF @DefaultWomenTeeID IS NOT NULL
            INSERT INTO dbo.CourseDefaults (CourseID, Gender, DefaultTeeID)
            VALUES (@CourseID, 'W', @DefaultWomenTeeID);

        -----------------------------------------------------------
        -- 5. Touch Course LastUpdatedUtc  (ONLY REQUIRED CHANGE)
        -----------------------------------------------------------
        UPDATE dbo.Courses
        SET LastUpdatedUtc = SYSUTCDATETIME()
        WHERE CourseID = @CourseID;

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        THROW;
    END CATCH;
END
