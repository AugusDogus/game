using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class CameraMovement : MonoBehaviour
{
    public Transform player;
    public float smoothing = 0.25f;
    public Vector2 maxPosition;
    public Vector2 minPosition;

    void LateUpdate()
    {
        if (transform.position != player.position)
        {
            // Make a new target position for the camera.
            // We use the player's position for horizontal and vertical movement, but keep the distance from the player the same.
            Vector3 target = new Vector3(player.position.x, player.position.y, transform.position.z);
            // Add our max + min positions for the map so the camera won't move out of bounds.
            target.x = Mathf.Clamp(target.x, minPosition.x, maxPosition.x);
            target.y = Mathf.Clamp(target.y, minPosition.y, maxPosition.y);
            // Finally, move our camera towards our target position.
            this.transform.position = Vector3.Lerp(transform.position, target, smoothing);
        }
    }
}
