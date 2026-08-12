begin;

-- cms_content_records.id pasa a ser la identidad editorial canónica que también
-- vive en el frontmatter. Un cambio de clave durante esta migración conserva el
-- historial de workflow asociado.
alter table public.cms_workflow_events
  drop constraint if exists cms_workflow_events_content_id_fkey;
alter table public.cms_workflow_events
  add constraint cms_workflow_events_content_id_fkey
  foreign key (content_id) references public.cms_content_records(id)
  on update cascade on delete cascade;

alter table public.cms_content_records
  drop constraint if exists cms_content_records_collection_check;
alter table public.cms_content_records
  add constraint cms_content_records_collection_check
  check (collection in (
    'entradas', 'memorias', 'paginas', 'simposios',
    'categorias', 'etiquetas', 'menus'
  ));

comment on column public.cms_content_records.id is
  'UUID v4 editorial canónico; coincide con id en el frontmatter Markdown.';

-- Mapa generado por scripts/migrate-content-uuids.mjs --write. Las filas ya
-- existentes conservan propietario, workflow y versión Git; solo se realinea
-- su clave canónica. Los documentos sin fila reciben metadata inicial y la
-- Function reconciliará github_sha al consultarlos.
with canonical(id, collection, path, initial_state) as (values
  ('7ae98086-23b8-427d-91e2-500a0716cfc5'::uuid, 'categorias', 'src/content/categorias/cultura.md', 'draft'),
  ('86073fa6-61af-41cf-831a-eadf27575671'::uuid, 'categorias', 'src/content/categorias/general.md', 'published'),
  ('180566cf-d753-4a34-9abc-905a386698c6'::uuid, 'entradas', 'src/content/entradas/1er-simposio.md', 'published'),
  ('c5c912d3-2199-4cbe-ba8a-8a895f902a70'::uuid, 'entradas', 'src/content/entradas/mi-nueva-vida.md', 'published'),
  ('517967c8-e0dd-4fdd-8fea-7afcbdbb9557'::uuid, 'etiquetas', 'src/content/etiquetas/memoria.md', 'published'),
  ('6b691f73-89ee-409a-b2ca-9e57f4e1471a'::uuid, 'etiquetas', 'src/content/etiquetas/museo-memorias.md', 'published'),
  ('3851352c-94a9-42b5-9caf-9404a34c90f7'::uuid, 'memorias', 'src/content/memorias/1-arte-sacro-social.md', 'published'),
  ('735fdc32-c636-43d2-8e65-c9c83e1d7363'::uuid, 'memorias', 'src/content/memorias/10-radio-almaina.md', 'published'),
  ('b5a24c95-c728-4868-aca9-a6e79764a72a'::uuid, 'memorias', 'src/content/memorias/11-amoratorio-de-creacion.md', 'published'),
  ('38d82fca-1c63-49f3-b145-9b727d9a7580'::uuid, 'memorias', 'src/content/memorias/12-muro-de-la-presencia.md', 'published'),
  ('fcb4995c-10c1-43da-a5c0-afdfef5e4b0d'::uuid, 'memorias', 'src/content/memorias/13-palimpsestos-paralelos.md', 'published'),
  ('63b0f3fd-98fa-4afe-8549-9d089302469f'::uuid, 'memorias', 'src/content/memorias/14-reproduzca-expansivamente.md', 'published'),
  ('d3e0f2fa-8c4e-46eb-b389-3bf1426de68a'::uuid, 'memorias', 'src/content/memorias/15-historicas-memorias-colectivo.md', 'published'),
  ('f8fa4f6b-7214-41f3-a36f-f7db4fd49fdb'::uuid, 'memorias', 'src/content/memorias/16-el-territorio-en-las-cosas.md', 'published'),
  ('ebf71e61-84a8-4dba-ac85-adbbb540c593'::uuid, 'memorias', 'src/content/memorias/18-la-madeja.md', 'published'),
  ('765b3435-11d4-4eab-a489-d2a54dc45e7d'::uuid, 'memorias', 'src/content/memorias/19-las-otras-memorias.md', 'published'),
  ('763ae014-61d6-4874-a6b4-c20af0224aa6'::uuid, 'memorias', 'src/content/memorias/20-encuentro-intergeneracional-sartaguda.md', 'published'),
  ('a58d0334-de73-457d-87aa-a0f4548ae3ad'::uuid, 'memorias', 'src/content/memorias/21-lorca-con-orgullo-vr.md', 'published'),
  ('ba7fc5ee-034f-45a6-aada-351e8403706b'::uuid, 'memorias', 'src/content/memorias/22-escuela-iberoamericana-mediacion.md', 'published'),
  ('a75dba80-d88a-4374-887b-8e80badb0b43'::uuid, 'memorias', 'src/content/memorias/24-elocuente-silencio-paisaje.md', 'published'),
  ('4fd78d69-c5f3-4f34-a011-94d9d4032a73'::uuid, 'memorias', 'src/content/memorias/25-cuerpos-que-resisten.md', 'published'),
  ('93f5a858-5d4e-4446-9606-6898b714da47'::uuid, 'memorias', 'src/content/memorias/26-herramientas-digitales-memoricidio.md', 'published'),
  ('ccb6ea85-e559-4ae5-8c7d-18541d938887'::uuid, 'memorias', 'src/content/memorias/27-politicas-culturales-memoria.md', 'published'),
  ('029e0eb2-e4af-4ddf-b205-c6929e417b01'::uuid, 'memorias', 'src/content/memorias/28-retratos-objetos-patrimonios.md', 'published'),
  ('4b5a2c98-ba16-48a4-8525-cbfeb875dedf'::uuid, 'memorias', 'src/content/memorias/29-cartografias-memorias-vecinales.md', 'published'),
  ('2bba6cfd-fc72-49df-a169-1d577534b75d'::uuid, 'memorias', 'src/content/memorias/3-sal-y-surco.md', 'published'),
  ('8f83d552-8446-48c5-9050-6cce6599d0c7'::uuid, 'memorias', 'src/content/memorias/30-libre.md', 'published'),
  ('1bd57f9e-eaa9-440d-a1f4-30052418ee14'::uuid, 'memorias', 'src/content/memorias/4-puebloagua-universo-anfibio.md', 'published'),
  ('ab35c423-ffb6-416d-9d3a-ca91e860f3c1'::uuid, 'memorias', 'src/content/memorias/5-proyecto-6402.md', 'published'),
  ('a0e595fa-7a10-4ce1-976b-e5327b6c6c4d'::uuid, 'memorias', 'src/content/memorias/6-ruta-al-exilio.md', 'published'),
  ('4904c9bd-74fd-463b-abf0-225a256945a4'::uuid, 'memorias', 'src/content/memorias/7-sabedores-ra.md', 'published'),
  ('ef9fb82e-df30-4663-900e-063af6fe1c05'::uuid, 'memorias', 'src/content/memorias/8-historias-inconclusas.md', 'published'),
  ('23ff0c2b-0f10-44d3-a2ca-1c0e3777eda8'::uuid, 'memorias', 'src/content/memorias/9-proyecto-etno-vega.md', 'published'),
  ('9e6d2692-97e1-46aa-bb0f-cdf41e23ce21'::uuid, 'menus', 'src/content/menus/principal.md', 'published'),
  ('2a1473a9-5ec4-49b4-8936-b20527485456'::uuid, 'paginas', 'src/content/paginas/2026-contacto.md', 'published'),
  ('948d5182-b492-45f0-be04-f752c9361b9c'::uuid, 'paginas', 'src/content/paginas/2026-el-simposio.md', 'published'),
  ('73739528-dda0-4f81-8cac-5fc7f405870c'::uuid, 'paginas', 'src/content/paginas/2026-larga-vida.md', 'published'),
  ('e7630540-fe9a-4d4b-8427-20160862601e'::uuid, 'paginas', 'src/content/paginas/2026-organizacion.md', 'published'),
  ('36780047-366b-463b-9240-454fabbc007a'::uuid, 'paginas', 'src/content/paginas/2026-programa.md', 'published'),
  ('968774eb-2ab0-47de-a1f6-ec517d162c52'::uuid, 'simposios', 'src/content/simposios/2026.md', 'published')
)
insert into public.cms_content_records (id, collection, path, workflow_state)
select id, collection, path, initial_state from canonical
on conflict (path) do update
set id = excluded.id,
    collection = excluded.collection;

commit;
