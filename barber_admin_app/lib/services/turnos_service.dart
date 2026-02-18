import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/turno.dart';

class TurnosService {
  static const String baseUrl = 'http://localhost:3000';

  static Future<List<Turno>> getTurnosHoy() async {
    final res = await http.get(Uri.parse('$baseUrl/turnos/hoy'));

    if (res.statusCode == 200) {
      final List data = json.decode(res.body);
      return data.map((e) => Turno.fromJson(e)).toList();
    } else {
      throw Exception('Error al cargar turnos');
    }
  }

  static Future<void> crearTurno({
    required String cliente,
    required String servicio,
    required String fecha,
    required String hora,
    String origen = 'panel',
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/turnos'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'cliente': cliente,
        'servicio': servicio,
        'fecha': fecha,
        'hora': hora,
        'origen': origen,
      }),
    );

    if (res.statusCode != 201 && res.statusCode != 200) {
      throw Exception('Error al crear turno');
    }
  }

  static Future<void> eliminarTurno(int id) async {
    final res =
        await http.delete(Uri.parse('$baseUrl/turnos/$id'));

    if (res.statusCode != 200) {
      throw Exception('Error al eliminar turno');
    }
  }
}
