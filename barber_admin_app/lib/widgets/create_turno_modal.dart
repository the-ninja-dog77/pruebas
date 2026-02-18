import 'package:flutter/material.dart';
import '../services/turnos_service.dart';

class CreateTurnoModal extends StatefulWidget {
  final VoidCallback onCreated;

  const CreateTurnoModal({super.key, required this.onCreated});

  @override
  State<CreateTurnoModal> createState() => _CreateTurnoModalState();
}

class _CreateTurnoModalState extends State<CreateTurnoModal> {
  final clienteCtrl = TextEditingController();
  final servicioCtrl = TextEditingController();
  final horaCtrl = TextEditingController();

  bool loading = false;

  Future<void> crear() async {
    setState(() => loading = true);

    await TurnosService.crearTurno(
      cliente: clienteCtrl.text,
      servicio: servicioCtrl.text,
      fecha: DateTime.now().toString().substring(0, 10),
      hora: horaCtrl.text,
    );

    widget.onCreated();
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Nuevo turno'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(controller: clienteCtrl, decoration: const InputDecoration(labelText: 'Cliente')),
          TextField(controller: servicioCtrl, decoration: const InputDecoration(labelText: 'Servicio')),
          TextField(controller: horaCtrl, decoration: const InputDecoration(labelText: 'Hora (HH:mm)')),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        ElevatedButton(
          onPressed: loading ? null : crear,
          child: loading ? const CircularProgressIndicator() : const Text('Crear'),
        ),
      ],
    );
  }
}
