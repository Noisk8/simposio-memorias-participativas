begin;

-- La navegacion publica ahora se define en el componente Header y deja de ser
-- contenido editorial administrable.
delete from public.cms_content_records
where collection = 'menus'
   or path like 'src/content/menus/%';

delete from public.cms_operation_keys
where resource_ref like 'src/content/menus/%';

-- role_permissions se limpia mediante la FK on delete cascade.
delete from public.permissions
where key in ('menu.read', 'menu.manage');

alter table public.cms_content_records
  drop constraint if exists cms_content_records_collection_check;
alter table public.cms_content_records
  add constraint cms_content_records_collection_check
  check (collection in (
    'entradas', 'memorias', 'paginas', 'simposios',
    'categorias', 'etiquetas'
  ));

commit;
