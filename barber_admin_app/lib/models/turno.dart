class Turno {
  final int id;
  final String cliente;
  final String servicio;
  final String fecha;
  final String hora;
  final String origen;

  Turno({
    required this.id,
    required this.cliente,
    required this.servicio,
    required this.fecha,
    required this.hora,
    required this.origen,
  });

  factory Turno.fromJson(Map<String, dynamic> json) {
    return Turno(
      id: json['id'],
      cliente: json['cliente'],
      servicio: json['servicio'],
      fecha: json['fecha'],
      hora: json['hora'],
      origen: json['origen'],
    );
  }
}
