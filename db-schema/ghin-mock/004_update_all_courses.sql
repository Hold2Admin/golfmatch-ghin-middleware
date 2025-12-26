-- Update at least one field on every course/tee/hole to trigger GolfMatch sync updates

-- Cedar Ridge Golf Club (GHIN-54321)
UPDATE GHIN_Tees SET courseRating = 71.6 WHERE teeId = 'GHIN-TEE-1001'; -- Blue M rating
UPDATE GHIN_Holes SET yardage = 385 WHERE teeId = 'GHIN-TEE-1001' AND holeNumber = 1; -- Blue M hole 1 yardage

-- Arrowhead Golf Club (GHIN-65432)
UPDATE GHIN_Tees SET slope = 146 WHERE teeId = 'GHIN-TEE-2001'; -- Championship M slope
UPDATE GHIN_Holes SET handicap = 10 WHERE teeId = 'GHIN-TEE-2002' AND holeNumber = 9; -- Championship W hole 9 handicap

-- The Broadmoor East Course (GHIN-76543)
UPDATE GHIN_Tees SET courseRating = 74.0 WHERE teeId = 'GHIN-TEE-3003'; -- Members M rating
UPDATE GHIN_Holes SET yardage = 460 WHERE teeId = 'GHIN-TEE-3001' AND holeNumber = 9; -- Tournament M hole 9 yardage

-- Torrey Pines South Course (GHIN-87654)
UPDATE GHIN_Tees SET slope = 143 WHERE teeId = 'GHIN-TEE-4001'; -- Black M slope
UPDATE GHIN_Holes SET par = 4 WHERE teeId = 'GHIN-TEE-4002' AND holeNumber = 15; -- Black W hole 15 par

-- Olympic Club Lake Course (GHIN-98765)
UPDATE GHIN_Tees SET yardage = 6801 WHERE teeId = 'GHIN-TEE-5003'; -- Players M total yardage
UPDATE GHIN_Holes SET handicap = 6 WHERE teeId = 'GHIN-TEE-5002' AND holeNumber = 5; -- Tournament W hole 5 handicap

-- Riviera Country Club (GHIN-13579)
UPDATE GHIN_Tees SET slope = 149 WHERE teeId = 'GHIN-TEE-6003'; -- Blue M slope
UPDATE GHIN_Holes SET yardage = 405 WHERE teeId = 'GHIN-TEE-6001' AND holeNumber = 3; -- Championship M hole 3 yardage
