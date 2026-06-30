
"""
Breakout Game in Python
CMSC 495 Capstone Project

This file contains a fully commented version of the Breakout game.
The comments are intentionally detailed so each major line and section
is easier to explain in class, in documentation, or during a presentation.

Game Summary:
- The player controls a paddle at the bottom of the screen.
- A ball bounces around the screen.
- The ball breaks bricks when it collides with them.
- The player earns points for each brick destroyed.
- The player starts with 3 lives.
- The game includes 3 levels.
- The ball speed increases with each level.
"""
# begin 
import asyncio
from websockets.asyncio.server import serve
# end

# sys is used so the program can safely exit when the user closes the game.
import sys

# dataclass helps create simple classes that mainly store data.
from dataclasses import dataclass

# List is used for type hints so the code clearly shows that bricks are stored in a list.
from typing import List

# pygame is the main game library used to create the window, draw graphics, and handle input.
import pygame


# ============================================================
# GAME SETTINGS / CONSTANTS
# ============================================================

# SCREEN_WIDTH stores the width of the game window in pixels.
SCREEN_WIDTH = 800

# SCREEN_HEIGHT stores the height of the game window in pixels.
SCREEN_HEIGHT = 600

# FPS controls how many frames per second the game tries to run.
FPS = 60


# -----------------------------
# Color Constants
# -----------------------------

# WHITE is used for text, outlines, and the ball.
WHITE = (255, 255, 255)

# BLACK is used as the background color.
BLACK = (18, 18, 18)

# LIGHT_BLUE is used for the paddle and some text.
LIGHT_BLUE = (80, 160, 255)

# RED is used for one row of bricks and the game over title.
RED = (220, 70, 70)

# GREEN is used for one row of bricks and the win title.
GREEN = (70, 190, 120)

# YELLOW is used for one row of bricks.
YELLOW = (245, 210, 80)

# PURPLE is used for one row of bricks.
PURPLE = (160, 100, 220)

# GRAY is used for secondary instruction text.
GRAY = (180, 180, 180)


# -----------------------------
# Paddle Settings
# -----------------------------

# PADDLE_WIDTH controls how wide the player paddle is.
PADDLE_WIDTH = 120

# PADDLE_HEIGHT controls how tall the player paddle is.
PADDLE_HEIGHT = 15

# PADDLE_SPEED controls how many pixels the paddle moves per frame.
PADDLE_SPEED = 8


# -----------------------------
# Ball Settings
# -----------------------------

# BALL_SIZE controls the width and height of the ball.
BALL_SIZE = 14

# BALL_START_SPEED_X controls the starting horizontal speed of the ball.
BALL_START_SPEED_X = 4

# BALL_START_SPEED_Y controls the starting vertical speed of the ball.
BALL_START_SPEED_Y = -4


# -----------------------------
# Brick Settings
# -----------------------------

# BRICK_ROWS controls how many rows of bricks appear.
BRICK_ROWS = 5

# BRICK_COLUMNS controls how many bricks are in each row.
BRICK_COLUMNS = 10

# BRICK_WIDTH controls the width of each brick.
BRICK_WIDTH = 70

# BRICK_HEIGHT controls the height of each brick.
BRICK_HEIGHT = 25

# BRICK_PADDING controls the space between bricks.
BRICK_PADDING = 8

# BRICK_TOP_OFFSET controls how far down from the top the brick grid begins.
BRICK_TOP_OFFSET = 80

# BRICK_LEFT_OFFSET controls how far from the left side the brick grid begins.
BRICK_LEFT_OFFSET = 35


# -----------------------------
# Player Settings
# -----------------------------

# STARTING_LIVES controls how many lives the player starts with.
STARTING_LIVES = 3


# ============================================================
# PADDLE CLASS
# ============================================================

# @dataclass automatically creates an __init__ method for this class.
@dataclass
class Paddle:
    """Represents the player-controlled paddle."""

    # x stores the paddle's horizontal position.
    x: int

    # y stores the paddle's vertical position.
    y: int

    # width stores the paddle's width and defaults to PADDLE_WIDTH.
    width: int = PADDLE_WIDTH

    # height stores the paddle's height and defaults to PADDLE_HEIGHT.
    height: int = PADDLE_HEIGHT

    # speed stores how fast the paddle moves and defaults to PADDLE_SPEED.
    speed: int = PADDLE_SPEED

    # The rect property creates a pygame rectangle for collision detection and drawing.
    @property
    def rect(self) -> pygame.Rect:
        # Return a rectangle based on the paddle's current position and size.
        return pygame.Rect(self.x, self.y, self.width, self.height)

    # The move method changes the paddle's x-position.
    def move(self, direction: int) -> None:
        """Move the paddle left or right. Direction should be -1, 0, or 1."""

        # Add movement to the paddle based on direction and speed.
        self.x += direction * self.speed

        # If the paddle moves past the left edge, keep it at the left edge.
        if self.x < 0:
            # Reset the paddle's x-position to 0 so it stays inside the screen.
            self.x = 0

        # If the paddle moves past the right edge, keep it inside the screen.
        if self.x + self.width > SCREEN_WIDTH:
            # Set the paddle's x-position so its right side lines up with the screen edge.
            self.x = SCREEN_WIDTH - self.width

    # The draw method displays the paddle on the screen.
    def draw(self, screen: pygame.Surface) -> None:
        # Draw the paddle as a rounded rectangle.
        pygame.draw.rect(screen, LIGHT_BLUE, self.rect, border_radius=8)


# ============================================================
# BALL CLASS
# ============================================================

# @dataclass automatically creates an __init__ method for this class.
@dataclass
class Ball:
    """Represents the ball used to break bricks."""

    # x stores the ball's horizontal position.
    x: float

    # y stores the ball's vertical position.
    y: float

    # speed_x stores how fast the ball moves left or right.
    speed_x: float = BALL_START_SPEED_X

    # speed_y stores how fast the ball moves up or down.
    speed_y: float = BALL_START_SPEED_Y

    # size stores the ball's width and height.
    size: int = BALL_SIZE

    # The rect property creates a pygame rectangle around the ball for collision detection.
    @property
    def rect(self) -> pygame.Rect:
        # Convert x and y to integers because pygame rectangles use integer coordinates.
        return pygame.Rect(int(self.x), int(self.y), self.size, self.size)

    # The reset method places the ball back in the center of the screen.
    def reset(self, level: int) -> None:
        """Reset the ball position and increase speed slightly by level."""

        # Place the ball horizontally in the center of the screen.
        self.x = SCREEN_WIDTH // 2 - self.size // 2

        # Place the ball vertically around the middle of the screen.
        self.y = SCREEN_HEIGHT // 2

        # Increase the ball speed by 10% for every level after level 1.
        speed_multiplier = 1 + ((level - 1) * 0.10)

        # Set the horizontal speed using the level speed multiplier.
        self.speed_x = BALL_START_SPEED_X * speed_multiplier

        # Set the vertical speed using the level speed multiplier.
        self.speed_y = BALL_START_SPEED_Y * speed_multiplier

    # The move method updates the ball's position each frame.
    def move(self) -> None:
        # Add horizontal speed to the x-position.
        self.x += self.speed_x

        # Add vertical speed to the y-position.
        self.y += self.speed_y

    # The bounce_x method reverses the ball's horizontal direction.
    def bounce_x(self) -> None:
        # Multiply the horizontal speed by -1 to make the ball move the opposite way.
        self.speed_x *= -1

    # The bounce_y method reverses the ball's vertical direction.
    def bounce_y(self) -> None:
        # Multiply the vertical speed by -1 to make the ball move the opposite way.
        self.speed_y *= -1

    # The draw method displays the ball on the screen.
    def draw(self, screen: pygame.Surface) -> None:
        # Draw the ball as a white ellipse inside its rectangle.
        pygame.draw.ellipse(screen, WHITE, self.rect)


# ============================================================
# BRICK CLASS
# ============================================================

# @dataclass automatically creates an __init__ method for this class.
@dataclass
class Brick:
    """Represents one brick in the brick grid."""

    # x stores the brick's horizontal position.
    x: int

    # y stores the brick's vertical position.
    y: int

    # width stores the brick's width.
    width: int

    # height stores the brick's height.
    height: int

    # color stores the brick's display color.
    color: tuple

    # points stores how many points the player earns for breaking this brick.
    points: int = 10

    # active determines whether the brick is still visible and breakable.
    active: bool = True

    # The rect property creates a pygame rectangle for collision detection and drawing.
    @property
    def rect(self) -> pygame.Rect:
        # Return a rectangle based on the brick's current position and size.
        return pygame.Rect(self.x, self.y, self.width, self.height)

    # The draw method displays the brick on the screen.
    def draw(self, screen: pygame.Surface) -> None:
        # Only draw the brick if it has not been destroyed.
        if self.active:
            # Draw the filled brick.
            pygame.draw.rect(screen, self.color, self.rect, border_radius=5)

            # Draw a white outline around the brick so the grid is easier to see.
            pygame.draw.rect(screen, WHITE, self.rect, 2, border_radius=5)


# ============================================================
# GAME CLASS
# ============================================================

class Game:
    """Main class that controls the Breakout game."""

    # The __init__ method runs when a new Game object is created.
    def __init__(self) -> None:
        # Initialize all pygame modules.
        pygame.init()

        # Set the title text that appears on the game window.
        pygame.display.set_caption("Breakout Game in Python")

        # Create the main game window using the screen width and height.
        self.screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))

        # Create a clock object to control the game frame rate.
        self.clock = pygame.time.Clock()

        # Create a large font for title text.
        self.title_font = pygame.font.SysFont("arial", 42, bold=True)

        # Create a medium font for main messages.
        self.medium_font = pygame.font.SysFont("arial", 28, bold=True)

        # Create a small font for instructions and the heads-up display.
        self.small_font = pygame.font.SysFont("arial", 22)

        # Create the player paddle and place it near the bottom center of the screen.
        self.paddle = Paddle(
            x=SCREEN_WIDTH // 2 - PADDLE_WIDTH // 2,
            y=SCREEN_HEIGHT - 50,
        )

        # Create the ball and place it near the center of the screen.
        self.ball = Ball(
            x=SCREEN_WIDTH // 2 - BALL_SIZE // 2,
            y=SCREEN_HEIGHT // 2,
        )

        # Set the player's starting score to 0.
        self.score = 0

        # Set the player's starting lives to the STARTING_LIVES constant.
        self.lives = STARTING_LIVES

        # Set the starting level to level 1.
        self.level = 1

        # Store the current game state.
        # Possible states are START, PLAYING, WIN, and GAME_OVER.
        self.game_state = "START"

        # Create an empty list that will store all Brick objects.
        self.bricks: List[Brick] = []

        # Build the first set of bricks.
        self.create_bricks()

    # The create_bricks method creates the full brick grid.
    def create_bricks(self) -> None:
        """Create a grid of bricks for the current level."""

        # Clear old bricks before creating a new brick grid.
        self.bricks.clear()

        # Store the brick row colors in a list.
        colors = [RED, YELLOW, GREEN, LIGHT_BLUE, PURPLE]

        # Loop through each brick row.
        for row in range(BRICK_ROWS):
            # Loop through each brick column.
            for col in range(BRICK_COLUMNS):
                # Calculate the brick's x-position using the column number.
                x = BRICK_LEFT_OFFSET + col * (BRICK_WIDTH + BRICK_PADDING)

                # Calculate the brick's y-position using the row number.
                y = BRICK_TOP_OFFSET + row * (BRICK_HEIGHT + BRICK_PADDING)

                # Create one brick object.
                brick = Brick(
                    x=x,
                    y=y,
                    width=BRICK_WIDTH,
                    height=BRICK_HEIGHT,
                    color=colors[row % len(colors)],
                    points=10,
                )

                # Add the new brick to the list of bricks.
                self.bricks.append(brick)

    # The reset_round method resets the ball and paddle without resetting the score.
    def reset_round(self) -> None:
        """Reset paddle and ball after losing a life or starting a new level."""

        # Move the paddle back to the horizontal center of the screen.
        self.paddle.x = SCREEN_WIDTH // 2 - PADDLE_WIDTH // 2

        # Reset the ball based on the current level.
        self.ball.reset(self.level)

    # The reset_game method starts a new game from level 1.
    def reset_game(self) -> None:
        """Start a new game from level 1."""

        # Reset the score to 0.
        self.score = 0

        # Reset lives back to the starting amount.
        self.lives = STARTING_LIVES

        # Reset the game back to level 1.
        self.level = 1

        # Change the state to PLAYING so the game begins.
        self.game_state = "PLAYING"

        # Create a fresh brick grid.
        self.create_bricks()

        # Reset the paddle and ball positions.
        self.reset_round()

    # The handle_events method handles keyboard actions and window events.
    def handle_events(self) -> None:
        """Handle keyboard input and window close events."""

        # Get every event that happened since the last frame.
        for event in pygame.event.get():
            # Check whether the user clicked the window close button.
            if event.type == pygame.QUIT:
                # Quit the game safely.
                self.quit_game()

            # Check whether the user pressed a key.
            if event.type == pygame.KEYDOWN:
                # If the user presses SPACE on the start screen, begin the game.
                if event.key == pygame.K_SPACE and self.game_state == "START":
                    # Start a new game.
                    self.reset_game()

                # If the user presses R after winning or losing, restart the game.
                if event.key == pygame.K_r and self.game_state in ["GAME_OVER", "WIN"]:
                    # Start a new game.
                    self.reset_game()

                # If the user presses ESC, quit the game.
                if event.key == pygame.K_ESCAPE:
                    # Quit the game safely.
                    self.quit_game()

    # The handle_paddle_movement method checks movement keys every frame.
    def handle_paddle_movement(self) -> None:
        """Move paddle based on keyboard input."""

        # Get the current state of all keyboard keys.
        keys = pygame.key.get_pressed()

        # Start with no movement.
        direction = 0

        # If LEFT arrow or A is pressed, move left.
        if keys[pygame.K_LEFT] or keys[pygame.K_a]:
            # Set direction to -1 for left movement.
            direction = -1

        # If RIGHT arrow or D is pressed, move right.
        elif keys[pygame.K_RIGHT] or keys[pygame.K_d]:
            # Set direction to 1 for right movement.
            direction = 1

        # Move the paddle using the direction value.
        self.paddle.move(direction)

    # The handle_wall_collisions method checks if the ball hits walls or falls below the screen.
    def handle_wall_collisions(self) -> None:
        """Handle ball collisions with the screen walls."""

        # Get the current rectangle around the ball.
        ball_rect = self.ball.rect

        # Check whether the ball has hit the left wall.
        if ball_rect.left <= 0:
            # Keep the ball inside the left edge.
            self.ball.x = 0

            # Reverse the ball's horizontal direction.
            self.ball.bounce_x()

        # Check whether the ball has hit the right wall.
        if ball_rect.right >= SCREEN_WIDTH:
            # Keep the ball inside the right edge.
            self.ball.x = SCREEN_WIDTH - self.ball.size

            # Reverse the ball's horizontal direction.
            self.ball.bounce_x()

        # Check whether the ball has hit the top wall.
        if ball_rect.top <= 0:
            # Keep the ball inside the top edge.
            self.ball.y = 0

            # Reverse the ball's vertical direction.
            self.ball.bounce_y()

        # Check whether the ball has fallen below the bottom of the screen.
        if ball_rect.top > SCREEN_HEIGHT:
            # Subtract one life from the player.
            self.lives -= 1

            # If the player has no lives left, the game is over.
            if self.lives <= 0:
                # Change the game state to GAME_OVER.
                self.game_state = "GAME_OVER"

            # If the player still has lives, reset the round.
            else:
                # Reset the paddle and ball positions.
                self.reset_round()

    # The handle_paddle_collision method checks if the ball hits the paddle.
    def handle_paddle_collision(self) -> None:
        """Handle ball collision with the paddle."""

        # Check if the ball rectangle overlaps the paddle rectangle.
        # The speed_y check prevents the ball from bouncing repeatedly while moving upward.
        if self.ball.rect.colliderect(self.paddle.rect) and self.ball.speed_y > 0:
            # Place the ball just above the paddle to prevent sticking.
            self.ball.y = self.paddle.y - self.ball.size

            # Reverse the ball's vertical direction so it bounces upward.
            self.ball.bounce_y()

            # Calculate the horizontal center of the paddle.
            paddle_center = self.paddle.x + self.paddle.width / 2

            # Calculate the horizontal center of the ball.
            ball_center = self.ball.x + self.ball.size / 2

            # Calculate how far from the paddle center the ball made contact.
            distance_from_center = ball_center - paddle_center

            # Use the hit position to adjust the ball's horizontal angle.
            self.ball.speed_x = distance_from_center / 15

            # Prevent the ball from moving almost straight up with very low horizontal movement.
            if -1 < self.ball.speed_x < 1:
                # Give the ball at least a small left or right movement.
                self.ball.speed_x = 1 if self.ball.speed_x >= 0 else -1

    # The handle_brick_collisions method checks if the ball hits any brick.
    def handle_brick_collisions(self) -> None:
        """Handle ball collisions with bricks."""

        # Loop through every brick in the brick list.
        for brick in self.bricks:
            # Only check collision if the brick is still active.
            if brick.active and self.ball.rect.colliderect(brick.rect):
                # Mark the brick as inactive so it disappears.
                brick.active = False

                # Add the brick's point value to the player's score.
                self.score += brick.points

                # Reverse the ball's vertical direction after hitting the brick.
                self.ball.bounce_y()

                # Stop checking after one brick collision to avoid multiple hits in one frame.
                break

        # Check if all bricks have been destroyed.
        if all(not brick.active for brick in self.bricks):
            # If the player has completed level 3, the player wins the game.
            if self.level >= 3:
                # Change the game state to WIN.
                self.game_state = "WIN"

            # If fewer than 3 levels have been completed, advance to the next level.
            else:
                # Increase the level number by 1.
                self.level += 1

                # Create a new brick grid for the next level.
                self.create_bricks()

                # Reset the paddle and ball for the next level.
                self.reset_round()

    # The update method updates the game logic every frame.
    def update(self) -> None:
        """Update all game objects."""

        # Only update gameplay while the game state is PLAYING.
        if self.game_state == "PLAYING":
            # Check paddle movement input.
            self.handle_paddle_movement()

            # Move the ball.
            self.ball.move()

            # Check wall collisions and life loss.
            self.handle_wall_collisions()

            # Check paddle collision.
            self.handle_paddle_collision()

            # Check brick collisions and level progression.
            self.handle_brick_collisions()

    # The draw_text_centered method helps draw centered text.
    def draw_text_centered(
        self,
        text: str,
        font: pygame.font.Font,
        color: tuple,
        y: int,
    ) -> None:
        """Draw text centered horizontally at a specific y-coordinate."""

        # Render the text into an image surface.
        text_surface = font.render(text, True, color)

        # Create a rectangle for the text and center it horizontally.
        text_rect = text_surface.get_rect(center=(SCREEN_WIDTH // 2, y))

        # Draw the text surface on the screen.
        self.screen.blit(text_surface, text_rect)

    # The draw_hud method draws the score, lives, and level.
    def draw_hud(self) -> None:
        """Draw score, lives, and level at the top of the screen."""

        # Create the score text surface.
        score_text = self.small_font.render(f"Score: {self.score}", True, WHITE)

        # Create the lives text surface.
        lives_text = self.small_font.render(f"Lives: {self.lives}", True, WHITE)

        # Create the level text surface.
        level_text = self.small_font.render(f"Level: {self.level}", True, WHITE)

        # Draw the score text on the left side of the screen.
        self.screen.blit(score_text, (20, 20))

        # Draw the lives text near the center of the screen.
        self.screen.blit(lives_text, (SCREEN_WIDTH // 2 - 45, 20))

        # Draw the level text on the right side of the screen.
        self.screen.blit(level_text, (SCREEN_WIDTH - 110, 20))

    # The draw_start_screen method draws the start menu.
    def draw_start_screen(self) -> None:
        """Draw the start screen."""

        # Draw the main game title.
        self.draw_text_centered("BREAKOUT", self.title_font, LIGHT_BLUE, 190)

        # Draw the subtitle.
        self.draw_text_centered("Python + Pygame Edition", self.medium_font, WHITE, 240)

        # Draw the instruction for starting the game.
        self.draw_text_centered("Press SPACE to Start", self.small_font, WHITE, 310)

        # Draw movement instructions.
        self.draw_text_centered("Use LEFT/RIGHT arrows or A/D to move", self.small_font, GRAY, 350)

        # Draw quit instruction.
        self.draw_text_centered("Press ESC to quit", self.small_font, GRAY, 385)

    # The draw_game_over_screen method draws the loss screen.
    def draw_game_over_screen(self) -> None:
        """Draw the game over screen."""

        # Draw the game over title.
        self.draw_text_centered("GAME OVER", self.title_font, RED, 230)

        # Draw the player's final score.
        self.draw_text_centered(f"Final Score: {self.score}", self.medium_font, WHITE, 290)

        # Draw restart and quit instructions.
        self.draw_text_centered("Press R to Restart or ESC to Quit", self.small_font, GRAY, 350)

    # The draw_win_screen method draws the win screen.
    def draw_win_screen(self) -> None:
        """Draw the win screen."""

        # Draw the win title.
        self.draw_text_centered("YOU WIN!", self.title_font, GREEN, 230)

        # Draw the player's final score.
        self.draw_text_centered(f"Final Score: {self.score}", self.medium_font, WHITE, 290)

        # Draw restart and quit instructions.
        self.draw_text_centered("Press R to Play Again or ESC to Quit", self.small_font, GRAY, 350)

    # The draw method draws the correct screen based on the current game state.
    def draw(self) -> None:
        """Draw the game screen."""

        # Fill the entire screen with the background color.
        self.screen.fill(BLACK)

        # Draw the start screen if the game has not started yet.
        if self.game_state == "START":
            # Show the start menu.
            self.draw_start_screen()

        # Draw gameplay objects if the game is currently being played.
        elif self.game_state == "PLAYING":
            # Draw score, lives, and level.
            self.draw_hud()

            # Draw the paddle.
            self.paddle.draw(self.screen)

            # Draw the ball.
            self.ball.draw(self.screen)

            # Loop through every brick.
            for brick in self.bricks:
                # Draw each active brick.
                brick.draw(self.screen)

        # Draw the game over screen if the player lost all lives.
        elif self.game_state == "GAME_OVER":
            # Show the game over screen.
            self.draw_game_over_screen()

        # Draw the win screen if the player completed all levels.
        elif self.game_state == "WIN":
            # Show the win screen.
            self.draw_win_screen()

        # Update the display so everything drawn appears on the screen.
        pygame.display.flip()

    # The run method contains the main game loop.
    def run(self) -> None:
        """Main game loop."""

        # Continue running the game forever until the player quits.
        while True:
            # Limit the game to the FPS value.
            self.clock.tick(FPS)

            # Handle keyboard and window events.
            self.handle_events()

            # Update game logic.
            self.update()

            # Draw the current frame.
            self.draw()

    # The quit_game method closes pygame and exits the program.
    def quit_game(self) -> None:
        """Safely quit the game."""

        # Shut down pygame.
        pygame.quit()

        # Exit the Python program.
        sys.exit()


# ============================================================
# PROGRAM ENTRY POINT
# ============================================================

# This checks whether this file is being run directly.
if __name__ == "__main__":
    # Create a new Game object.
    game = Game()

    # Start the main game loop.
    game.run()




 
