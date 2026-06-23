import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  private auth = inject(AuthService);

  async ngOnInit() {
    // Handle Azure AD redirect callback at root level — BEFORE the auth guard runs
    await this.auth.handleRedirectCallback();
  }
}
