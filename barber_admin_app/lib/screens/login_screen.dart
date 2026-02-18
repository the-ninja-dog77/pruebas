import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final userController = TextEditingController();
  final passController = TextEditingController();

  String error = '';
  bool loading = false;

  Future<void> login() async {
    setState(() {
      loading = true;
      error = '';
    });

    try {
      final response = await http.post(
        Uri.parse('http://localhost:3000/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'username': userController.text,
          'password': passController.text,
        }),
      );

      if (response.statusCode == 200) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => const HomeScreen()),
        );
      } else {
        setState(() {
          error = 'Datos incorrectos';
        });
      }
    } catch (e) {
      setState(() {
        error = 'Error de conexión con el servidor';
      });
    }

    setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Container(
          width: 330,
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.black,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.cyanAccent),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'ZZETA BARBER CLUB',
                style: TextStyle(
                  color: Colors.cyanAccent,
                  fontSize: 22,
                ),
              ),
              const SizedBox(height: 20),

              TextField(
                controller: userController,
                decoration: const InputDecoration(
                  labelText: 'Usuario',
                ),
              ),
              const SizedBox(height: 10),

              TextField(
                controller: passController,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Contraseña',
                ),
              ),

              const SizedBox(height: 15),

              if (error.isNotEmpty)
                Text(error, style: const TextStyle(color: Colors.redAccent)),

              const SizedBox(height: 15),

              ElevatedButton(
                onPressed: loading ? null : login,
                child: loading
                    ? const CircularProgressIndicator()
                    : const Text('ENTRAR'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
