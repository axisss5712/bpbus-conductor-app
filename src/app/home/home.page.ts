import { CommonModule } from '@angular/common';
import type { OnInit, OnDestroy } from '@angular/core';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Geolocation } from '@capacitor/geolocation';
import { IonContent } from '@ionic/angular';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent],
})
export class HomePage implements OnInit, OnDestroy {
  serverUrl: string = 'http://192.168.1.8:8000';
  conductor: any = null;

  username: string = '';
  password: string = '';
  fullName: string = '';
  selectedBusId: string = 'BUS-101';
  authError: string = '';

  stops: any[] = [];
  availableBuses: any[] = [];
  activeBus: any = null;
  originStopId: number = 1;
  destStopId: number = 4;
  passengerType: string = 'Regular';
  passengerCount: number = 1;

  dropoffs: any[] = [];
  remittance: any = {
    total_tickets: 0,
    total_passengers_carried: 0,
    total_fare_collected: 0,
  };
  gpsStatus: string = 'GPS Standby';
  private gpsTimer?: any;

  ngOnInit(): void {
  this.loadFleetList();
  }

  async loadFleetList(): Promise<void> {
    try {
      const res = await fetch(`${this.serverUrl}/api/buses`);
      if (res.ok) {
        this.availableBuses = await res.json();
        if (this.availableBuses.length > 0 && !this.selectedBusId) {
          this.selectedBusId = this.availableBuses[0].bus_id;
        }
      }
    } catch {
      // Wait until user clicks Sync or checks IP
    }
  }


  ngOnDestroy(): void {
    if (this.gpsTimer) {
      clearInterval(this.gpsTimer);
    }
  }

  formatMoney(val: number | undefined): string {
    return Number(val || 0).toFixed(2);
  }

async login(): Promise<void> {
    this.authError = '';
    const uname = this.username.trim();
    const pword = this.password.trim();
    if (!uname || !pword) {
      this.authError = 'Please enter your employee username and password.';
      return;
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: uname,
          password: pword,
          role: 'Conductor',
          assigned_bus_id: this.selectedBusId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.authError = data.detail || 'Invalid conductor credentials.';
        return;
      }
      this.conductor = data;
      this.selectedBusId = data.assigned_bus_id || this.selectedBusId;
      await this.refreshAll();
      this.gpsTimer = setInterval(() => this.broadcastLiveGps(), 4000);
    } catch {
      this.authError = 'Server unreachable. Check Ubuntu IP.';
    }
  }

  async signup(): Promise<void> {
    this.authError = '';
    const uname = this.username.trim();
    const pword = this.password.trim();
    const fname = this.fullName.trim() || uname;
    if (!uname || !pword) {
      this.authError = 'Please enter a new username and password to sign up.';
      return;
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: uname,
          password: pword,
          full_name: fname,
          role: 'Conductor',
          assigned_bus_id: this.selectedBusId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.authError = data.detail || 'Sign-up error.';
        return;
      }
      // Log in directly using the newly created conductor account
      this.conductor = data;
      this.selectedBusId = data.assigned_bus_id || this.selectedBusId;
      await this.refreshAll();
      this.gpsTimer = setInterval(() => this.broadcastLiveGps(), 4000);
    } catch {
      this.authError = 'Server unreachable. Check Ubuntu IP.';
    }
  }

  logout(): void {
    this.conductor = null;
    if (this.gpsTimer) {
      clearInterval(this.gpsTimer);
    }
  }

  async refreshAll(): Promise<void> {
    try {
      const resStops = await fetch(`${this.serverUrl}/api/stops`);
      this.stops = await resStops.json();

      const resBuses = await fetch(`${this.serverUrl}/api/buses`);
      const buses = await resBuses.json();
      this.availableBuses = buses;
      this.activeBus = buses.find((b: any) => b.bus_id === this.selectedBusId) || buses[0];

      const resDrop = await fetch(`${this.serverUrl}/api/tickets/dropoffs/${this.selectedBusId}`);
      this.dropoffs = await resDrop.json();

      const resRem = await fetch(`${this.serverUrl}/api/remittance?bus_id=${this.selectedBusId}`);
      const remList = await resRem.json();
      if (remList.length > 0) {
        this.remittance = remList[0];
      }
    } catch {
      // Ignore transient network errors
    }
  }

  haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  previewDistanceKm(): number {
    const s1 = this.stops.find((s) => s.stop_id === Number(this.originStopId));
    const s2 = this.stops.find((s) => s.stop_id === Number(this.destStopId));
    if (!s1 || !s2) return 0;
    return Math.max(0.5, this.haversineKm(s1.lat, s1.lng, s2.lat, s2.lng));
  }

  previewTotalFare(): number {
    const dist = this.previewDistanceKm();
    let unitFare = 15.0 + Math.max(0, dist - 4.0) * 2.2;
    if (this.passengerType === 'Discounted') {
      unitFare *= 0.8;
    }
    return unitFare * Math.max(1, Number(this.passengerCount || 1));
  }

  async issueTicket(): Promise<void> {
    const res = await fetch(`${this.serverUrl}/api/tickets/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bus_id: this.selectedBusId,
        issued_by_user_id: this.conductor?.user_id || null,
        origin_stop_id: Number(this.originStopId),
        destination_stop_id: Number(this.destStopId),
        passenger_type: this.passengerType,
        passenger_count: Math.max(1, Number(this.passengerCount || 1)),
      }),
    });
    if (res.ok) {
      await this.refreshAll();
    }
  }

  async clearDropoff(destinationStopId: number): Promise<void> {
    await fetch(`${this.serverUrl}/api/tickets/dropoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bus_id: this.selectedBusId,
        destination_stop_id: destinationStopId,
      }),
    });
    await this.refreshAll();
  }

  async broadcastLiveGps(): Promise<void> {
    if (!this.activeBus) return;
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 3000,
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      this.gpsStatus = `GPS Live (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

      await fetch(`${this.serverUrl}/api/buses/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bus_id: this.selectedBusId,
          lat,
          lng,
          current_passengers: this.activeBus.current_passengers,
          max_seated: this.activeBus.max_seated,
          max_standing: this.activeBus.max_standing,
          event_source: 'Conductor GPS',
        }),
      });

      for (const d of this.dropoffs) {
        if (this.haversineKm(lat, lng, d.lat, d.lng) <= 0.1) {
          await this.clearDropoff(d.destination_stop_id);
        }
      }
      await this.refreshAll();
    } catch {
      this.gpsStatus = 'Synced with Route Telemetry';
      await this.refreshAll();
    }
  }
}