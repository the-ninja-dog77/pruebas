import 'package:flutter/material.dart';
import '../models/turno.dart';
import '../services/turnos_service.dart';
import '../widgets/create_turno_modal.dart';

class TodayTurnsScreen extends StatefulWidget {
  const TodayTurnsScreen({super.key});

  @override
  State<TodayTurnsScreen> createState() => _TodayTurnsScreenState();
}

class _TodayTurnsScreenState extends State<TodayTurnsScreen> {
  late Future<List<Turno>> futureTurnos;

  @override
  void initState() {
    super.initState();
    futureTurnos = fetchTurnos();
  }

  Future<List<Turno>> fetchTurnos() {
    return TurnosService.getTurnosHoy();
  }

  // 🔴 CONFIRMAR Y ELIMINAR TURNO
  Future<void> confirmarYEliminar(Turno turno) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Eliminar turno'),
        content: Text(
          '¿Seguro que querés eliminar el turno de ${turno.cliente} a las ${turno.hora}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await TurnosService.eliminarTurno(turno.id);
      setState(() {
        futureTurnos = fetchTurnos();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Turnos de Hoy'),
      ),
      floatingActionButton: FloatingActionButton(
        child: const Icon(Icons.add),
        onPressed: () {
          showDialog(
            context: context,
            builder: (_) => CreateTurnoModal(
              onCreated: () {
                setState(() {
                  futureTurnos = fetchTurnos();
                });
              },
            ),
          );
        },
      ),
      body: FutureBuilder<List<Turno>>(
        future: futureTurnos,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return const Center(child: Text('Error al cargar turnos'));
          }

          final turnos = snapshot.data!;

          if (turnos.isEmpty) {
            return const Center(child: Text('No hay turnos hoy'));
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: turnos.length,
            itemBuilder: (context, index) {
              final t = turnos[index];
              return Card(
                child: ListTile(
                  leading: const Icon(Icons.content_cut),
                  title: Text(t.cliente),
                  subtitle: Text('${t.servicio} • ${t.hora}'),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete, color: Colors.red),
                    onPressed: () => confirmarYEliminar(t),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
