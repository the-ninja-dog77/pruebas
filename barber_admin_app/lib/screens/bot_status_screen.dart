import 'package:flutter/material.dart';

class BotStatusScreen extends StatefulWidget {
  const BotStatusScreen({super.key});

  @override
  State<BotStatusScreen> createState() => _BotStatusScreenState();
}

class _BotStatusScreenState extends State<BotStatusScreen> {
  bool botActive = true;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Estado del Bot')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              botActive ? Icons.check_circle : Icons.cancel,
              size: 80,
              color: botActive ? Colors.greenAccent : Colors.redAccent,
            ),
            const SizedBox(height: 20),
            Text(botActive ? 'BOT ACTIVO' : 'BOT APAGADO'),
            Switch(
              value: botActive,
              onChanged: (v) => setState(() => botActive = v),
            ),
          ],
        ),
      ),
    );
  }
}
