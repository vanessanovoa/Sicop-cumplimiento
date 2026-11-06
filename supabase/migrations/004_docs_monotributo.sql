-- SICOP · documentos opcionales de empleados presentes en algunos Excel:
-- seguro de accidentes personales y pago de monotributo (solo aplican a monotributistas;
-- si la celda está vacía no se audita).
insert into public.tipos_documento (categoria, nombre, requerido, orden) values
  ('Empleados','Seguro de accidentes personales',false,6), ('Empleados','Pago monotributo',false,7)
on conflict (categoria, nombre) do nothing;
