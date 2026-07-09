insert into users (name, role)
values
  ('Hernando', 'chefe_oficina'),
  ('Wesley', 'tecnico'),
  ('Ayslan', 'tecnico'),
  ('Gilvan', 'tecnico'),
  ('Elimarcos', 'tecnico'),
  ('Rosangela', 'consultor'),
  ('Eliane', 'consultor'),
  ('Jose Cleverton', 'consultor'),
  ('Lider de Posto', 'lider_lavagem'),
  ('Estoquista', 'estoquista'),
  ('Coordenador de Qualidade', 'qualidade'),
  ('Gerente', 'gerente')
on conflict (email) do nothing;
