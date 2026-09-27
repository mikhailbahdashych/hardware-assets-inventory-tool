DROP INDEX `members_employee_idx`;--> statement-breakpoint
-- Written by hand, not generated: an instance that already has two members
-- on one employee would otherwise fail this migration at boot, every boot.
-- The earliest member keeps the link; the later ones are unlinked, which is
-- what an admin would have had to do before the index could exist.
UPDATE `members` SET `employee_id` = NULL
WHERE `employee_id` IS NOT NULL AND EXISTS (
  SELECT 1 FROM `members` AS earlier
  WHERE earlier.`employee_id` = `members`.`employee_id`
    AND (earlier.`created_at` < `members`.`created_at`
      OR (earlier.`created_at` = `members`.`created_at` AND earlier.`id` < `members`.`id`))
);--> statement-breakpoint
CREATE UNIQUE INDEX `members_one_per_employee` ON `members` (`employee_id`) WHERE employee_id IS NOT NULL;