-- The source text a suggestion was written against. If the source changes later, the suggestion is flagged
-- and cannot be approved (the author or a reviewer must act), so a translation never goes live for a text it does not match.
ALTER TABLE suggestions ADD COLUMN source_snapshot TEXT NOT NULL DEFAULT '';
