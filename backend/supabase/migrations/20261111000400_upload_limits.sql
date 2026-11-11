-- Error-handling fix (Nov 2026): uploads are limited to images, with a size
-- cap, by storage itself — not only by the app screens.
update storage.buckets
set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'crop-validation-photos';

update storage.buckets
set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'announcement-images';

update storage.buckets
set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'avatars';
