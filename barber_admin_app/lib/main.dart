import 'package:flutter/material.dart';
import 'package:barber_admin_app/theme/app_theme.dart';
import 'package:barber_admin_app/screens/login_screen.dart';

void main() {
  runApp(const BarberAdminApp());
}

class BarberAdminApp extends StatelessWidget {
  const BarberAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'ZZETA Barber Club',
      theme: AppTheme.darkTheme,
      home: const LoginScreen(),
    );
  }
}
